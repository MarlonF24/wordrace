# WordRace

WordRace is a monorepo for a multiplayer word-link game and its learned route-hint service. Players click words embedded in definitions and lexical fields to move from a start word toward a target word. Collide mode gives each player two lanes, one from each end, and ends when both lanes meet.

## Mental Model

The repository contains two independently deployable applications:

- `apps/nextjs_app`: Next.js routes, game UI, Drizzle schemas, migrations, and dictionary ingestion.
- `apps/search_agent`: FastAPI search endpoints, graph snapshots, learned-cost inference, and ML-schema migrations.

PostgreSQL is shared by both applications. Caddy exposes only Next.js; the web container calls the search agent over the private Compose network.

The database is split into two logical schemas:

- `dictionary`: source and processed lexical data. The processed `dictionary` table stores rich JSONB entries and a generated `all_links` field for graph/search consumers.
- `data` or `public`: player IDs, games, and each player's race history for a game.

## Game Flow

1. `src/proxy.ts` assigns each browser a long-lived `playerId` cookie.
2. `src/app/start-game-form.tsx` collects start/target words, game mode, lemmatization, and selected lexical fields.
3. `src/app/start-game-action.ts` calls `DATA_DB.createGame`.
4. `src/lib/db/data/service.ts` normalizes both endpoints, validates dictionary availability and Wink POS rules, creates the game, and joins the creating player.
5. `src/app/game/[gameId]/page.tsx` loads the current game/player link and chooses normal or collide lane rendering.
6. `src/app/game/[gameId]/rich-text-renderer.tsx` renders legal rich tokens as buttons and submits clicks to `addRaceStep`, which revalidates the persisted game rule before appending the step.
7. `apps/nextjs_app/src/app/api/search-difficulty/route.ts` optionally asks `search_agent` for a route hint after the current game state is loaded.

## Rich Text And Links

Dictionary prose is stored as `RichText`, an array of strings and `RichToken` objects:

```ts
type RichToken = {
    l: string;
    p: WinkPosTag;
    w: string;
};
```

- `w` is the displayed surface word.
- `l` is the lemma used when a game is configured with lemmatization.
- `p` is the uppercase Wink NLP part-of-speech tag used by games and search.

`LexicalEntry.pos` deliberately remains the lowercase Wiktionary vocabulary from
the source data. `RichToken.p`, race history, game availability, graph edges, and
ML search constraints use Wink POS. These are different facts and are not
converted into one another.

`RichTextRenderer` applies `game.availablePos` to every rich token, whether it
came from prose, an example, a category, or an explicit lexical field. Normal
mode enables every Wink tag. Collide mode disables `ADP`, `AUX`, `CCONJ`, `DET`,
`PART`, `PRON`, and `SCONJ`. Dictionary record loading still displays every
matching Wiktionary entry; there is no dictionary-entry POS lock.

## Dictionary Processing

The dictionary seed pipeline lives in `src/lib/db/dictionary/seed.ts`.

- Raw Kaikki/Wiktionary JSONL is loaded into `dictionary_raw`.
- Raw entries are grouped by lowercased word.
- `processRawEntry` converts raw entries into display-ready `LexicalEntry` objects.
- `tokenizeToRichText` converts glossary/example text and displayed object fields into rich tokens.
- `processSenses` turns repeated Wiktionary gloss paths into a tree of `GlossNode`s so the UI can render nested senses without repeating shared parent gloss text.

The generated `all_links` column is shaped for graph/search consumers as
`w|l -> lexical key -> POS -> words`. Search selects the `w` or `l` root once,
then applies lexical-field and POS constraints used by game rules and ML route
hints.

```json
{
    "w": {
        "glosses": {
            "NOUN": ["dog"]
        },
        "synonyms": {
            "NOUN": ["hound"]
        }
    }
}
```

After changing rich-token shape, dictionary processing, or `all_links`, reseed processed dictionary JSON and regenerate the ML graph parquet files.

## Commands

Run frontend commands from `apps/nextjs_app`:

```bash
bun run dev
bunx tsc --noEmit
bun run lint
bun run build
bun run db:migrate
bun run db:push
bun --env-file=.env src/lib/db/dictionary/seed.ts
```

`bun run lint` should complete without errors or warnings.

Run search-agent commands from the repository root:

```bash
uv run --directory apps --project search_agent python -m search_agent.main --help
uv run --directory apps --project search_agent python -m pytest search_agent/tests
```

## Environment

The Next.js server resolves database, schema, seed, and search-service values through `tydantic-settings`, which validates and coerces them into one immutable `SETTINGS` object. The search agent uses the equivalent `pydantic-settings` boundary. Browser components import only environment-free game metadata, so settings and database credentials remain server-only.

- `DICT_SCHEMA`: schema for dictionary tables.
- `DATA_SCHEMA`: schema for game/player tables, defaulting to `public`.
- Standard Postgres connection values used by the DB clients and seed scripts.
- `DB_HOST_PORT`: loopback-only host port for PostgreSQL, defaulting to `5432`.
- `SEED_DATA_PATH`: JSONL source path used by the dictionary seed script.
- `SEARCH_AGENT_URL`: base URL for the optional FastAPI `search_agent` route-hint service.
- `SEARCH_AGENT_PORT`: internal and optional local host port for the search API, defaulting to `8000`.

## Containers

Copy `.env.example` to `.env` for local Compose use. Local builds use the ignored checkpoint under `apps/search_agent/search`; production builds download it from a pinned Hugging Face Model revision.

```bash
docker compose config
docker compose up --build
```

Compose runs the Next.js migrations before starting the web app, then runs the search-agent Alembic migration before starting the API. PostgreSQL uses the pgvector image required by the `ml.embeddings` table. Dictionary and embedding imports are explicit bootstrap operations, so ordinary app deployments never reseed production data.

## Model And Data Releases

Hugging Face stores two private repositories with distinct responsibilities:

- A Model repository contains `best_CostApproximation.pt`.
- A Dataset repository contains the graph Parquets plus `dictionary.dump` and `ml_embeddings.dump`.

Matching release tags are convenient labels, while full commit IDs provide strict immutability. A Hugging Face Collection may group the repositories for navigation but is not part of deployment.

Local source runs and local Docker builds read the ignored checkpoint from `apps/search_agent`. Production image builds download that checkpoint from the Model repository and copy it into the image. The API traverses dictionary edges and loads embeddings from PostgreSQL, so it does not use the Parquet graph; those files remain Dataset-repository inputs for local training, benchmarking, and exact evaluation. Database dumps are downloaded onto Oracle only for bootstrap and restored into PostgreSQL. Running applications therefore use the image-local checkpoint and PostgreSQL without Hugging Face credentials or network access.

### Export database data

`pg_dump` accepts a libpq connection URI, so the same commands work with a local service, a Compose container, or a remote PostgreSQL instance. Export only the two processed dictionary tables required at runtime; `dictionary_raw` remains an ingestion intermediate:

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

Use the libpq `postgresql://` scheme rather than a SQLAlchemy driver scheme such as `postgresql+asyncpg://`. Percent-encode reserved characters in URI credentials. Both dump files and their source JSONL are excluded from Git and Docker build contexts.

### Publish releases

The `hf` CLI uses HTTPS and a user access token; it does not use the SSH key configured for Git operations. Authenticate with a fine-grained write token, upload each artifact to its intended repository path, then tag the completed repository states:

```bash
uvx --from huggingface-hub hf auth login

uvx --from huggingface-hub hf upload OWNER/wordrace-model \
  apps/search_agent/search/deep_learn/models/best_CostApproximation.pt \
  best_CostApproximation.pt \
  --commit-message 'Publish WordRace model v1'

uvx --from huggingface-hub hf upload OWNER/wordrace-data \
  apps/search_agent/search/graph graph \
  --repo-type dataset \
  --include '*.parquet' \
  --commit-message 'Publish WordRace graph v1'
uvx --from huggingface-hub hf upload OWNER/wordrace-data \
  apps/nextjs_app/dictionary.dump database/dictionary.dump \
  --repo-type dataset \
  --commit-message 'Publish WordRace dictionary v1'
uvx --from huggingface-hub hf upload OWNER/wordrace-data \
  apps/search_agent/ml_embeddings.dump database/ml_embeddings.dump \
  --repo-type dataset \
  --commit-message 'Publish WordRace embeddings v1'

uvx --from huggingface-hub hf repos tag create OWNER/wordrace-model v1
uvx --from huggingface-hub hf repos tag create \
  OWNER/wordrace-data v1 --repo-type dataset
```

Configure the GitHub `production` environment with these repository variables:

- `SEARCH_MODEL_REPOSITORY` and `SEARCH_MODEL_REVISION`.

The repository value uses `OWNER/name`; its revision uses a tag or full commit ID. Give the GitHub `HF_TOKEN` secret fine-grained read access to the private Model repository. GitHub Actions receives it only while building the image.

Developers who need the exact graph release can download it into the local paths expected by training and benchmark commands:

```bash
uvx --from huggingface-hub hf download OWNER/wordrace-data \
  graph/wiktionary_nodes.parquet \
  graph/wiktionary_edges.parquet \
  --repo-type dataset \
  --revision DATA_REVISION \
  --local-dir apps/search_agent/search
```

### Database bootstrap

Download the selected database dumps from the Dataset repository onto Oracle with a temporary read token:

```bash
uvx --from huggingface-hub hf download OWNER/wordrace-data \
  database/dictionary.dump \
  database/ml_embeddings.dump \
  --repo-type dataset \
  --revision DATA_REVISION \
  --local-dir ~/wordrace/bootstrap
```

Run both schema migrations before restoring their corresponding data. These commands deliberately fail on duplicate rows, making bootstrap an explicit empty-database operation:

```bash
cd ~/wordrace
docker compose --env-file .env.production --file docker-compose.yml \
  run --rm --no-deps nextjs_migrate
docker compose --env-file .env.production --file docker-compose.yml \
  exec -T db sh -c \
  'exec pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --single-transaction --exit-on-error' \
  < bootstrap/database/dictionary.dump

docker compose --env-file .env.production --file docker-compose.yml \
  run --rm --no-deps search_agent_migrate
docker compose --env-file .env.production --file docker-compose.yml \
  exec -T db sh -c \
  'exec pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --single-transaction --exit-on-error' \
  < bootstrap/database/ml_embeddings.dump
```

Restore the dictionary first because `ml.embeddings.word` references `dictionary.words.word`. Back up PostgreSQL independently; release artifacts reproduce derived data but do not replace operational backups.

## Production Deployment

The two path-filtered workflows build ARM64 images in GHCR and update only their own Compose service on the Oracle host:

- `deploy-nextjs.yml` reacts to `apps/nextjs_app`, runs web migrations, replaces `nextjs_app`, and reconciles Caddy.
- `deploy-search-agent.yml` reacts to `apps/search_agent`, runs Alembic, and replaces only `search_agent_app`.

Provision Docker with the Compose plugin on the Oracle instance, then create `~/wordrace/.env.production` from `.env.example`. Point `NEXTJS_APP_IMAGE` and `SEARCH_AGENT_APP_IMAGE` at this repository's GHCR `main` tags. Deploy Next.js once before the first search-agent deployment so the referenced dictionary schema exists.

PostgreSQL is bound to `127.0.0.1:${DB_HOST_PORT:-5432}` on the Oracle host. To inspect production from a local database client without exposing PostgreSQL to the internet, open an SSH tunnel:

```bash
ssh -N -L 15432:127.0.0.1:5432 ORACLE_USER@ORACLE_HOST
```

While that command is running, connect pgAdmin to `127.0.0.1:15432` with the production database name, user, and password. Keep TCP port `5432` closed in Oracle's public ingress rules.

Configure the GitHub `production` environment with these secrets:

- `ORACLE_HOST`, `ORACLE_USER`, and `ORACLE_SSH_KEY` for deployment access.
- `ORACLE_HOST_FINGERPRINT`, containing the verified SHA-256 fingerprint of the Oracle SSH host key.
- `HF_TOKEN` with read access to the private Hugging Face Model repository.

Each workflow updates one `main` image tag and invokes Compose with `--no-deps` for that application. SHA image tags remain in GHCR for traceability and manual rollback; deploying one application does not restart the other.

The search Dockerfile uses uv to install the locked Python environment and Docker to build the deployable OCI image. `uv build` is intentionally not part of this flow: it creates Python wheels and source distributions, while `search_agent` is an application run from its source tree rather than a reusable package.

## Operational Notes

- Reseed processed dictionary data after changing `RichToken`, lexical-field processing, or tokenization behavior.
- Regenerate `apps/search_agent/search/graph/*.parquet` after reseeding dictionary data that changes `all_links`.
- If `drizzle push` makes dictionary performance worse, reseed the dictionary data; the local note in `apps/nextjs_app/src/lib/db/dictionary/README.md` records this failure mode.
- Avoid adding compatibility layers for old rich-token JSON shapes unless there is an explicit migration requirement.

## Credits And Data Sources

This project uses Open English WordNet and Kaikki/Wiktionary-derived dictionary data.

The dictionary data was obtained from: https://kaikki.org/dictionary/English/index.html

### Citations

- Open English WordNet: John P. McCrae, Alexandre Rademaker, Francis Bond, Ewa Rudnicka and Christiane Fellbaum (2019) _English WordNet 2019 - An Open-Source WordNet for English_. In Proceedings of the 10th Global WordNet Conference (GWC 2019), Wroclaw, Poland.
  [Website: https://en-word.net/](https://en-word.net/)

- Princeton WordNet (Original):
  Christiane Fellbaum (1998, ed.) _WordNet: An Electronic Lexical Database_. Cambridge, MA: MIT Press.

### License

The data is provided under the [Creative Commons Attribution 4.0 International (CC-BY 4.0)](https://creativecommons.org/licenses/by/4.0/) license.
