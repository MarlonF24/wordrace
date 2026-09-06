# WordRace Search Agent

Search and learned-cost services for the WordRace dictionary graph.

## Running the API

The server reads `API_HOST` and `API_PORT`; local defaults are `127.0.0.1:8000`.

```bash
uv run --directory apps --project search_agent python -m search_agent.main serve
```

`GET /health` is reserved for process/container readiness checks.

## Runtime Artifacts

The search image reads its checkpoint from a local filesystem path. A local build copies ignored weights from this project; a production build downloads the checkpoint from a private Hugging Face Model repository. The download happens during the image build, so running containers require neither Hub credentials nor network access.

The API traverses dictionary edges and loads embeddings from PostgreSQL. It does not read the Parquet graph; those files live in the Dataset repository for local training, benchmarking, and exact evaluation.

Database embeddings and the processed dictionary live in PostgreSQL rather than the image. Export their runtime tables from any reachable PostgreSQL instance using portable custom-format dumps:

```bash
WORDRACE_DATABASE_URL='postgresql://user:password@localhost:5432/wordrace'
pg_dump \
  --dbname="$WORDRACE_DATABASE_URL" \
  --data-only \
  --format=custom \
  --table=dictionary.dictionary \
  --table=dictionary.words \
  --file=apps/nextjs_app/dictionary.dump

pg_dump \
  --dbname="$WORDRACE_DATABASE_URL" \
  --data-only \
  --format=custom \
  --table=ml.embeddings \
  --file=apps/search_agent/ml_embeddings.dump
```

Use the libpq `postgresql://` scheme rather than a SQLAlchemy driver scheme such as `postgresql+asyncpg://`. Percent-encode reserved characters in URI credentials.

Upload and tag the Model repository:

```bash
uvx --from huggingface-hub hf upload OWNER/wordrace-model \
  apps/search_agent/search/deep_learn/models/best_CostApproximation.pt \
  best_CostApproximation.pt \
  --commit-message 'Publish WordRace model v1'
uvx --from huggingface-hub hf repos tag create OWNER/wordrace-model v1
```

Upload the graph and database dumps to the Dataset repository, then tag its completed state:

```bash
uvx --from huggingface-hub hf upload OWNER/wordrace-data \
  apps/search_agent/search/graph graph \
  --repo-type dataset \
  --include '*.parquet'
uvx --from huggingface-hub hf upload OWNER/wordrace-data \
  apps/nextjs_app/dictionary.dump database/dictionary.dump \
  --repo-type dataset
uvx --from huggingface-hub hf upload OWNER/wordrace-data \
  apps/search_agent/ml_embeddings.dump database/ml_embeddings.dump \
  --repo-type dataset
uvx --from huggingface-hub hf repos tag create \
  OWNER/wordrace-data v1 --repo-type dataset
```

Production builds select the checkpoint through `SEARCH_MODEL_REPOSITORY` and `SEARCH_MODEL_REVISION`. Database dumps are one-time bootstrap inputs, while graph Parquets are development and evaluation inputs; none are copied into the production image. The root README contains graph download and Oracle bootstrap commands.

uv installs the locked Python environment inside the image with `uv sync`. `uv build` is not used because it produces Python distribution archives rather than deployable OCI images, and this service is not published as a Python library.

## Search API

`POST /search` and `POST /collide-search` accept the same typed request:

```json
{
    "start": "dog",
    "target": "cat",
    "constraints": {
        "lemmatized": true,
        "available_lexical_fields": ["glosses", "synonyms"],
        "available_pos": ["NOUN", "VERB"]
    }
}
```

Regular search returns one complete directed path:

```json
{
    "start_path": ["dog", "animal", "cat"]
}
```

Collide search returns two complete outgoing paths whose final word is the same:

```json
{
    "start_path": ["dog", "animal"],
    "target_path": ["cat", "animal"]
}
```

A valid request with no legal path returns HTTP 404. Operational failures remain
service errors. Link counts are derived from the returned paths rather than
duplicated in the response.

The endpoints use separate `GeneralizedShortestPathSearch` instances, allowing regular
and collide defaults to be configured independently. Both API instances use
learned A-star ordering with weight `1.0` and unreachable penalty `0`.

## Search Model

| Term            | Meaning                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Search Edge** | A directed transition whose finite cost is at least `MIN_EDGE_COST`. Database dictionary links use the minimum cost, `1.0`. |
| **Search Node** | The best path version currently known for a word, containing accumulated cost, link depth, and a parent reference.          |
| **Frontier**    | One lane's discovered best paths together with its **Open Set**.                                                            |
| **Open Set**    | The uniquely keyed words currently queued for expansion in priority order.                                                  |
| **Incumbent**   | The cheapest complete regular path or collide meeting discovered so far.                                                    |
| **Collision**   | A word discovered from both collide roots. Its solution cost is the sum of the two lane costs.                              |

The search package separates its public contracts, scoring, traversal, and
exact evaluation:

- `contracts.py` defines `EdgeConstraints`, response models, and the
  `SearchAlgorithm` protocol.
- `scoring.py` defines **Search Nodes**, scorer preparation, and heuristic
  implementations.
- `search.py` performs budgeted database traversal with **Frontiers**.
- `igraph.py` provides exact traversal over exported parquet graph data.

`SearchAlgorithm` exposes regular and collide operations. The database-backed
implementation reads constrained dictionary links, while `IgraphSearch`
provides the same result shapes from an exported in-memory graph.

### Cost and path state

`MIN_EDGE_COST` is `1.0`. Link readers must supply finite `SearchEdge` costs at
or above that value; the database adapter constructs only unit-cost edges.
`SearchNode.cost` accumulates edge costs, `SearchNode.depth` counts links, and
parent references reconstruct the returned path. Cost and depth are therefore
independent even though current database traversal is unit-cost.

`GeneralizedShortestPathSearch.max_cost` defaults to `8`. Regular search applies it to
the path from start to target; collide search applies it independently to each
lane. It is an exclusive solution-cost limit, so every returned lane costs less
than `max_cost`.

Each expanded source word consumes one unit from `max_expansions`, independent
of the number of database queries. All source words popped in one iteration are
read by one batched query. Both collide lanes share the word budget. If the
budget ends during a batch, the query includes the prefix that still fits and
its children are admitted before the search returns.

### Frontier invariant

A **Frontier** retains the cheapest discovered **Search Node** for each word.
Only a strict cost improvement replaces that node, and every replacement is
eligible to re-enter the frontier so its cheaper path can propagate to
descendants. Its indexed **Open Set** contains each queued word at most once;
improving a queued word updates its priority rather than retaining an obsolete
path version.

Finite beam trimming retains the best eligible entries in the **Open Set** and
leaves discovered best paths intact. A trimmed word can therefore re-enter the
queue when a strictly cheaper path is found later.

## Search Workflows

### Regular search

1. The start node seeds one **Frontier**, and the scorer is prepared for the
   fixed target.
2. The lowest-priority live nodes are expanded within the cost and expansion
   limits.
3. Discovering the target records or improves the **Incumbent** without
   expanding the target.
4. Later nodes remain eligible while their path cost can improve the
   **Incumbent**. An admissible priority bound may additionally discard work
   that cannot improve it.
5. Search returns the cheapest target node discovered before the eligible queue
   or expansion budget is exhausted.

### Collide search

Collide search finds two outgoing paths from the supplied words to a common
descendant. This is a shortest-common-descendant problem, not a conventional
forward/backward search along one start-to-goal path.

1. Each root seeds its own **Frontier** and discovered-node map.
2. The lane with the lowest live priority expands next; equal priorities
   alternate between lanes.
3. Every admitted improvement is checked against the opposite lane's
   discovered nodes. A shared word creates or improves the **Incumbent**
   **Collision**.
4. Search continues after a collision while queued paths can still produce a
   cheaper meeting.

Each lane is scored against the fixed root of the other lane. These scores order
expansion but do not lower-bound common-descendant solutions, even when the
scorer is admissible for regular search. Collide pruning therefore uses path
cost: an expanded node must be able to traverse an edge costing at least
`MIN_EDGE_COST` while staying below both `max_cost` and the combined
**Incumbent** cost.

### Scoring and bounds

`bind_target(...)` prepares a scorer for one fixed target and reuses
target-specific state across batches. Regular search binds the requested target;
each collide lane binds the root of the other lane. Each admitted continuation
batch is scored together, allowing the embedding query and learned model to
process multiple candidates at once.

Learned and embedding heuristics are non-admissible by default because their
estimates can overstate remaining cost. A-star priorities are regular-search
lower bounds only when the heuristic is explicitly admissible and its weight is
between `0` and `1`, inclusive. Collide search never interprets scorer priority
as a solution bound. Every valid regular-search lower bound must be strictly
lower than the tighter of `max_cost` and the current **Incumbent** cost.

`best_first_search(...)` and `beam_search(...)` are the supported search
presets.

## Search Benchmark

The staged benchmark uses named profiles containing complete `EdgeConstraints`.
Its matrix crosses lemma/raw links, glosses/all lexical fields, and all/collide
Wink POS sets for regular and collide search. Each profile uses the 10 curated
cases plus 10 seed-42 dynamic cases with `max_expansions=300`. Screening is
complete for both modes; the selected finalists have also completed the four
100-case suites with `max_expansions=1000`.

Run screening from the repository parent:

```bash
uv run --directory apps --project search_agent python -m search_agent.main screening
```

Configurations with exceptions are ineligible. The remaining configurations
are ranked per mode by reachable success rate, mean optimality, and p95 latency.
The top three can then run through the four 100-case final suites:

```bash
uv run --directory apps --project search_agent python -m search_agent.main final \
  --regular-finalist ALGORITHM \
  --regular-finalist ALGORITHM \
  --regular-finalist ALGORITHM \
  --collide-finalist ALGORITHM \
  --collide-finalist ALGORITHM \
  --collide-finalist ALGORITHM
```

Omitting the finalist options uses the current ranked defaults. Typer also
exposes the available commands and option syntax through `--help`.

Raw and aggregate CSV files are ignored by Git. Every row records the profile,
algorithm, configured maximum cost, endpoint paths and lane link counts, exact
igraph cost, optimality, duration, status, and any exception.

See `search/findings.md` for the completed evaluation scope, measured results,
and current finalist status.

## Graph Contract

The web dictionary `all_links` JSONB field is
`w|l -> lexical key -> POS -> words`. Selecting the root `w` or `l` branch
applies the lemmatization rule once before lexical-field and POS filtering.
`graph.py` exports the same dimensions, including `target_pos`, into
`wiktionary_edges.parquet`. The POS dimension is the 18-value uppercase Wink
vocabulary carried by rich tokens; lowercase Wiktionary entry POS remains a
separate display/source-data field.

Dictionary vertices are lowercase. Database traversal and graph export both
lowercase link targets before resolving them to vertices, so capitalization in
display-oriented raw tokens cannot create a separate terminal or collision.

After reseeding processed dictionary data or changing
`flatten_lexical_blob_mapped`, regenerate `apps/search_agent/search/graph/*.parquet`
before using `IgraphSearch`:

```bash
uv run --directory apps --project search_agent python -m search_agent.search.graph
```

`IgraphSearch` validates required parquet columns and rejects unknown
`target_pos` values before constructing a graph.

## Cost Approximation

`CostApproximation` predicts reachability and remaining graph cost under the
same settings used by search. Each 1,570-column row contains current and target
embeddings, pair interactions, the lemmatization flag, the lexical-field mask,
and the 18-value Wink POS mask. Dataset generation and
`LearnedCostHeuristic` share the same feature builder.

Generate the default single-file, 500,000-row dataset from the repository
parent:

```bash
uv run --directory apps --project search_agent python -m search_agent.search.deep_learn.cost_apprx
```

This writes `search/deep_learn/data/cost_approx_dataset.pt` with seed 42,
random-source sampling, and a 60% reachable share. The training notebook loads
that `MapCostDataset` directly, uses its seeded 80/10/10 split, saves the best
epoch as `candidate_CostApproximation.pt`, evaluates the candidate on the held
out test split, and promotes it to `best_CostApproximation.pt` only when all
test metrics are finite.

## DB Interface Synchronization

Run `./db_gen.sh` from this directory to regenerate SQLAlchemy models from the
live schemas after Drizzle changes. This keeps the Python database interface in
sync with the TypeScript schema.

## PGVector

Dont forget to install pgvector on the database host, otherwise the code cant add the extension and create the vector column
