# Search Evaluation Findings

## Evaluation scope

The search migration was evaluated on 3 September 2026 with broad screening,
four 100-case finalist suites, and a focused regular-search tuning pass. Every
measured configuration completed without an exception.

| Setting | Screening | Final |
| --- | ---: | ---: |
| Constraint profiles | 8 per mode | 2 per mode |
| Cases per profile | 20 | 100 |
| Expansion budget | 300 | 1,000 |
| Regular algorithms | 10 | 3 finalists |
| Collide algorithms | 6 | 3 finalists |
| Cost limit | Exclusive `max_cost=8` | Exclusive `max_cost=8` |

Screening covers every combination of lemma/raw links, glosses/all lexical
fields, and all/collide POS sets. Final evaluation uses game-oriented gloss
edges with all POS for regular search and the restricted collide POS set for
collide search, each in lemma and raw link modes. Screening combines 10 curated
and 10 seeded generated cases; each final suite combines the same curated cases
with 90 generated cases.

A **reachable case** has a route in the corresponding exported igraph snapshot.
A **successful case** returns paths with the requested endpoint relationship.
**Optimality** is the exact igraph link count divided by the returned link count;
`100%` means equal link counts. Latency includes successful and exhausted
no-route calls but excludes exceptions. Database transitions currently cost
`1.0`, so link-count comparisons are also cost comparisons.

## Screening results

### Regular search

The rows aggregate 160 reachable cases per configuration across all eight
profiles. The two batch-16 configurations were measured as a follow-up on the
same endpoint sets, limits, and host.

| Algorithm | Solved | Success | Mean optimality | p95 ms | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| `embedding-a-star-w2-b16` | 70 / 160 | 43.8% | 100.0% | 1,861 | 0 |
| `embedding-a-star-w1` | 70 / 160 | 43.8% | 100.0% | 2,190 | 0 |
| `embedding-a-star-w1-b16` | 70 / 160 | 43.8% | 100.0% | 2,584 | 0 |
| `learned-a-star-w0.5-p0` | 59 / 160 | 36.9% | 100.0% | 3,823 | 0 |
| `embedding-global-greedy` | 58 / 160 | 36.2% | 85.8% | 1,998 | 0 |
| `learned-a-star-w1-p0` | 57 / 160 | 35.6% | 100.0% | 3,377 | 0 |
| `learned-a-star-w1-p1` | 57 / 160 | 35.6% | 100.0% | 3,423 | 0 |
| `breadth-first` | 54 / 160 | 33.8% | 100.0% | 813 | 0 |
| `learned-a-star-w1-p3` | 53 / 160 | 33.1% | 99.5% | 3,522 | 0 |
| `learned-global-greedy` | 38 / 160 | 23.8% | 68.4% | 2,453 | 0 |

Batching does not make the budget-limited search equivalent to one-at-a-time
best-first expansion. Compared with `embedding-a-star-w1`, the batch-16 runs
changed the success status of 21/160 cases and selected a different equal-length
path for 49 cases that both policies solved. The gains and losses balanced:
each configuration solved 70 cases with the same mean optimality.

### Collide search

Every collide configuration reported a solution for all 160 screening cases.
The raw-link caveat below affects one shared screening case, which is why the
reported aggregate optimality is slightly above `100%`.

| Algorithm | Solved | Success | Reported optimality | p95 ms | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| `breadth-first` | 160 / 160 | 100.0% | 100.2%* | 332 | 0 |
| `embedding-a-star-w1` | 160 / 160 | 100.0% | 100.2%* | 398 | 0 |
| `learned-a-star-w1-p1` | 160 / 160 | 100.0% | 100.2%* | 517 | 0 |
| `learned-a-star-w0.5-p0` | 160 / 160 | 100.0% | 100.2%* | 541 | 0 |
| `learned-a-star-w1-p0` | 160 / 160 | 100.0% | 100.2%* | 568 | 0 |
| `learned-a-star-w1-p3` | 160 / 160 | 100.0% | 100.2%* | 572 | 0 |

Finalists are ranked by reachable success rate, mean optimality, p95 latency,
and name, after rejecting any configuration with an exception. The CLI defaults
are:

| Rank | Regular | Collide |
| ---: | --- | --- |
| 1 | `embedding-a-star-w2-b16` | `breadth-first` |
| 2 | `embedding-a-star-w1` | `embedding-a-star-w1` |
| 3 | `embedding-a-star-w1-b16` | `learned-a-star-w1-p1` |

## Final results

### Regular search

All 200 final regular cases were reachable in the exact graph. Every finalist
solved the same 50 cases with the same paths and exact link counts. Weight `2`,
batch `16` had the lowest aggregate p95 at 1,073 ms. Weight `1`, batch `16`
measured 1,168 ms, while one-at-a-time weight `1` measured 2,831 ms.

| Profile | Algorithm | Solved | Success | Mean optimality | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: |
| Lemma | `embedding-a-star-w2-b16` | 22 / 100 | 22.0% | 100.0% | 961 |
| Lemma | `embedding-a-star-w1` | 22 / 100 | 22.0% | 100.0% | 2,964 |
| Lemma | `embedding-a-star-w1-b16` | 22 / 100 | 22.0% | 100.0% | 1,105 |
| Raw | `embedding-a-star-w2-b16` | 28 / 100 | 28.0% | 100.0% | 1,107 |
| Raw | `embedding-a-star-w1` | 28 / 100 | 28.0% | 100.0% | 2,626 |
| Raw | `embedding-a-star-w1-b16` | 28 / 100 | 28.0% | 100.0% | 1,226 |

`embedding-a-star-w2-b16` is the strongest measured regular configuration. Its
batching benefit is workload-dependent: the broad screening p95 improved by
15%, while the game-oriented final p95 improved by 62%. The final cases happened
to preserve exact per-case behavior, but broad screening demonstrates that this
is not a general semantic guarantee. The benchmark CLI defaults use the ranked
selection; the HTTP service retains its separately configured learned A-star
policy.

The 25% final success rate is an expansion-budget result, not a reachability
result. Every exact route costs less than `8`, but most targets are not reached
within 1,000 expansions in the graph's large outgoing search space.

### Collide search

All three collide finalists reported a collision for every final case.
Breadth-first has the lowest mean latency and no model dependency, making it the
simplest collide default. Embedding A-star recorded the lowest aggregate p95,
628 ms versus 680 ms for breadth-first, but did not improve coverage or path
length.

| Profile | Algorithm | Reported solved | Reported optimality | p95 ms |
| --- | --- | ---: | ---: | ---: |
| Lemma | `breadth-first` | 100 / 100 | 100.0% | 651 |
| Lemma | `embedding-a-star-w1` | 100 / 100 | 100.0% | 692 |
| Lemma | `learned-a-star-w1-p1` | 100 / 100 | 100.0% | 730 |
| Raw | `breadth-first` | 100 / 100* | 102.9%* | 686 |
| Raw | `embedding-a-star-w1` | 100 / 100* | 102.9%* | 423 |
| Raw | `learned-a-star-w1-p1` | 100 / 100* | 102.9%* | 568 |

The raw-link values marked `*` are not evidence of super-optimal search. In nine
of the 100 raw final cases, both database lanes met at the same capitalized link
token, such as `"Having"`, even though only its lowercase form is a dictionary
vertex. The exported exact graph excludes such dangling targets. The remaining
91 raw cases matched the exact link count for every finalist. Until the database
reader and graph export use the same vertex-normalization rule, raw collide
success and optimality are not strictly comparable with the exact baseline. One
screening case had the same issue.

## Focused regular tuning

The tuning pass used 20 evenly spaced cases from each final regular profile.
All configurations used the same 1,000-expansion and exclusive cost limits.

| Configuration family | Variants | Best solved | Mean optimality | Best p95 ms |
| --- | --- | ---: | ---: | ---: |
| Embedding A-star, batch 1 | Weights `0.5`, `1`, `2`, `4` | 12 / 40 | 100.0% | 2,497 |
| Embedding A-star, batch 4 or 16 | Weights `1`, `2` | 12 / 40 | 100.0% | 1,131 |
| Embedding A-star, beam 64 | Weights `1`, `2` | 5 / 40 | 90.0% | 628 |
| Learned A-star, batch 1 | Weights `0.5`, `2` | 13 / 40 | 100.0% | 6,061 |
| Breadth-first, batch 1 | — | 10 / 40 | 100.0% | 1,857 |
| Embedding greedy, batch 1 | — | 4 / 40 | 100.0% | 3,208 |

Increasing the embedding weight did not improve success. Weight `2` was modestly
faster than weight `1`, while weight `4` regressed at the tail. Learned weight
`2` gained one raw-profile success over weight `0.5` in this small sample, but
it gained no lemma success and remained about four times slower than the best
batched embedding configuration. That isolated gain is insufficient to promote
it without a larger confirmation.

Beam search made the expected completeness tradeoff: it was the fastest family
but solved fewer than half as many cases and returned one longer raw path. A
beam is suitable only when latency matters more than discovery and route quality.

### Learned-ordering follow-up

A batch-16 follow-up used the same 40 cases and limits to check whether the
learned heuristic benefits from batched expansion or stronger use of its
reachability head.

| Learned configuration | Solved | Exact-length results | Re-expansions |
| --- | ---: | ---: | ---: |
| Weight `0.5`, penalty `0` | 12 / 40 | 12 / 12 | 0 |
| Weight `1`, penalty `0` | 12 / 40 | 12 / 12 | 0 |
| Weight `2`, penalty `0` | 13 / 40 | 13 / 13 | 0 |
| Weight `1`, penalty `1` | 12 / 40 | 12 / 12 | 0 |
| Weight `1`, penalty `3` | 12 / 40 | 12 / 12 | 0 |

Batching reduced round trips without materially changing the earlier learned
results. Weight `2` retained its one-case advantage, while reachability
penalties did not change aggregate coverage. This is not enough evidence to
replace the screening-selected embedding configuration.

## Regular-search failure diagnosis

Success in the final suite falls sharply with exact route length:

| Exact link count | Solved |
| ---: | ---: |
| 1 | 1 / 1 |
| 2 | 4 / 4 |
| 3 | 28 / 28 |
| 4 | 17 / 68 |
| 5 | 0 / 56 |
| 6 | 0 / 39 |
| 7 | 0 / 4 |

Every exact route is below the configured threshold. A controlled 36-case
sample therefore varied the threshold and expansion budget independently:

| Threshold and budget | Cost 3 | Cost 4 | Cost 5 | Cost 6–7 |
| --- | ---: | ---: | ---: | ---: |
| `max_cost=8`, 1,000 expansions | 4 / 4 | 4 / 12 | 0 / 8 | 0 / 12 |
| `max_cost=12`, 1,000 expansions | 4 / 4 | 4 / 12 | 0 / 8 | 0 / 12 |
| `max_cost=8`, 3,000 expansions | 4 / 4 | 8 / 12 | 0 / 8 | 0 / 12 |
| `max_cost=8`, 10,000 expansions | 4 / 4 | 12 / 12 | 1 / 8 | 0 / 12 |

Increasing `max_cost` did not alter any measured expansion or result. Increasing
the budget recovered cost-four targets first seen between roughly 1,000 and
7,200 expansions, but ten times the production budget recovered only one of
eight sampled cost-five targets. Each expanded source produced roughly 40–76
outgoing edge records in this workload. The low success rate is therefore an
expansion and ordering problem in a high-branching graph, not a cost-threshold
or repropagation problem.

Embedding A-star weights `4`, `8`, and `16` each reproduced the weight-`2`
result on the controlled sample. Pure embedding-greedy search reached different
deeper targets but lost an easy result, returned longer paths, and performed
2,109 repeated expansions. More heuristic weight cannot compensate for a
semantic signal that does not reliably describe directed graph distance.

The pre-migration search from commit `b4ab0e6` also solved exactly 8/36 matched
cases at 1,000 expansions, with the same successes and no repeated expansions.
Its earlier reported percentages came from 12 mostly curated cases and are not
comparable with the current 200-case final suite. The matched run provides no
evidence that the frontier migration reduced regular-search coverage.

## Correctness and threshold behavior

The frontier stores one cheapest discovered label and at most one queued entry
per word. A strict cost improvement replaces the label and re-enters the indexed
open set even if an earlier, more expensive label was expanded. This
label-correcting behavior is required when ordering scores are non-admissible.

The same exclusive threshold is checked at several lifecycle points for
different reasons:

- Admission rejects a generated path that cannot beat the configured limit or
  incumbent. Positive edges make every descendant at least as expensive.
- Enqueueing requires `node.cost + MIN_EDGE_COST < threshold`, because an open
  node must be able to traverse at least one more edge and still improve the
  result.
- Popping repeats the eligibility check because a later incumbent may have
  tightened the threshold since enqueueing.
- Finite beam trimming applies the current threshold so ineligible entries do
  not occupy retained beam slots. Unrestricted queues leave this lazy work to
  popping.

Regular search also compares priority with the threshold when the scorer
explicitly supplies an admissible solution lower bound. Embedding and learned
heuristics are non-admissible by default and affect ordering only. Collide
search uses accumulated lane cost for safe pruning; scores aimed at the opposite
root do not bound the cost of an unknown common descendant.

With an unrestricted queue, sufficient expansion budget, positive edges, and a
consistent graph adapter, the label-correcting engine finds the cheapest
eligible result despite non-admissible ordering. Finite beams and expansion
budgets intentionally remove that completeness guarantee.

## Efficiency assessment

The frontier and database boundaries serve different ordering needs:

- `best_by_word` provides constant-time dominance checks.
- The indexed priority queue performs insertion, replacement, and removal in
  logarithmic time without stale duplicate entries.
- Batch admission collapses duplicate child words before persistent state and
  scorer updates.
- Popped words remain in priority order through expansion-budget truncation.
  The selected prefix is converted to a set only for the PostgreSQL `IN` query,
  whose source-keyed result is re-associated with the ordered parent nodes.
- Scoring and outgoing-link retrieval each process one expansion batch.

Batch `16` substantially reduces database and embedding round trips. It is a
bounded relaxed best-first policy, not a transparent query optimization: all 16
parents are selected before any of their children can tighten an incumbent or
change the next priority decision. The benchmark therefore names the batch size
as part of the configuration.

The results do not support blaming strict-improvement repropagation for low
regular success. The embedding A-star diagnostic expanded no word twice, while
greater heuristic pressure did not improve aggregate discovery. The most direct
next experiments are:

1. Train or derive a graph-aware target heuristic rather than relying only on
   semantic similarity.
2. Evaluate candidate rank on real search frontiers and train with shortest-path
   successors and hard sibling negatives if ranking remains poor.
3. Reduce branching through game-appropriate lexical-field and POS rules.
4. If regular target search becomes the main workload, evaluate a true reverse
   adjacency index and conventional forward/backward search.

## Learned checkpoint context

Evaluation reused `best_CostApproximation.pt` without retraining. The checkpoint
matches the current model architecture and feature layout. The training notebook
loads the first two of four saved `random_sampling` datasets, whose generation
fixes the reachable share at 60%; it does not use the available outgoing-neighbor
sampling strategy or recorded search frontiers. The checkpoint is a plain state
dictionary without embedded dataset provenance, so the exact originating run is
represented by the notebook and these recorded held-out metrics:

```text
reachable_cost_mae=0.5711
reachable_cost_residual_std=0.7799
reachability_precision=0.9127
reachability_recall=0.7678
reachability_specificity=0.8887
```

The `0.5711` cost MAE applies to reachable random source-target rows. It does
not measure whether a shortest-path successor ranks above dozens of sibling
candidates during search, and it does not include the cost head's behavior on
unreachable rows. Repeating training on the same random-pair distribution would
not by itself address that objective mismatch.

Raw and summarized CSV files are written under `search/benchmark_results/` and
remain ignored artifacts. Reproduce the staged evaluation with:

```bash
uv run --directory apps --project search_agent python -m search_agent.main screening
uv run --directory apps --project search_agent python -m search_agent.main final
```
