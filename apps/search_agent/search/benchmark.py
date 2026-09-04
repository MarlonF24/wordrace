"""Reproducible regular and collide benchmarks for constrained graph search."""

from __future__ import annotations

import csv
import json
import math
import time
from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal, cast

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from tqdm.auto import tqdm

from search_agent.db import Embeddings, SelectableLexicalKey, WinkPosTag
from search_agent.logger import logger
from search_agent.search.contracts import (
    CollideSearchResult,
    EdgeConstraints,
    RegularSearchResult,
)
from search_agent.search.igraph import IgraphSearch
from search_agent.search.scoring import (
    AStarScorer,
    BreadthFirstScorer,
    EmbeddingSimilarityHeuristic,
    GreedyScorer,
    LearnedCostHeuristic,
)
from search_agent.search.search import GeneralizedShortestPathSearch


type SearchMode = Literal["regular", "collide"]
type BenchmarkStatus = Literal["success", "no_route", "error"]
type SearchResult = RegularSearchResult | CollideSearchResult

DEFAULT_TEST_CASES = (
    ("finally", "hello"),
    ("science", "hello"),
    ("mountain", "ocean"),
    ("coffee", "morning"),
    ("fast", "slow"),
    ("philosophy", "physics"),
    ("serendipity", "chaos"),
    ("quantum", "bread"),
    ("adventure", "boredom"),
    ("symphony", "noise"),
)
COLLIDE_FORBIDDEN_POS = frozenset(
    {
        WinkPosTag.ADP,
        WinkPosTag.AUX,
        WinkPosTag.CCONJ,
        WinkPosTag.DET,
        WinkPosTag.PART,
        WinkPosTag.PRON,
        WinkPosTag.SCONJ,
    }
)
COLLIDE_AVAILABLE_POS = frozenset(WinkPosTag).difference(COLLIDE_FORBIDDEN_POS)
GLOSSES_ONLY = frozenset({SelectableLexicalKey.GLOSSES})
ALL_LEXICAL_FIELDS = frozenset(SelectableLexicalKey)
ALL_POS = frozenset(WinkPosTag)
BENCHMARK_OUTPUT_DIR = Path(__file__).parent / "benchmark_results"


@dataclass(frozen=True)
class BenchmarkProfile:
    """Name one complete, reusable set of graph-edge constraints."""

    name: str
    edge_constraints: EdgeConstraints


@dataclass(frozen=True)
class BenchmarkAlgorithm:
    """Name one search configuration and identify learned-model warmups."""

    name: str
    search: GeneralizedShortestPathSearch
    uses_learned_model: bool = False


@dataclass(frozen=True)
class BenchmarkResult:
    """Store one timed algorithm result with its exact-search comparison."""

    stage: str
    mode: SearchMode
    profile: str
    algorithm: str
    max_cost: float
    lemmatized: bool
    lexical_fields: str
    available_pos: str
    start_word: str
    target_word: str
    status: BenchmarkStatus
    start_path: tuple[str, ...] | None
    target_path: tuple[str, ...] | None
    start_links: int | None
    target_links: int | None
    combined_links: int | None
    exact_cost: int | None
    optimality: float | None
    duration_ms: float
    error: str | None

    def to_csv_row(self) -> dict[str, object]:
        """Return a flat row with paths serialized as JSON arrays."""
        row = asdict(self)
        row["start_path"] = (
            json.dumps(self.start_path) if self.start_path is not None else ""
        )
        row["target_path"] = (
            json.dumps(self.target_path) if self.target_path is not None else ""
        )
        return row


@dataclass(frozen=True)
class ComparisonSummary:
    """Aggregate reachable-case quality, latency, and failures."""

    stage: str
    mode: SearchMode
    profile: str
    algorithm: str
    max_cost: float
    total_cases: int
    reachable_cases: int
    successes: int
    reachable_success_rate: float
    mean_duration_ms: float
    p50_duration_ms: float
    p95_duration_ms: float
    mean_path_length: float
    mean_optimality: float
    exception_count: int


def make_profile(
    lemmatized: bool,
    lexical_fields: frozenset[SelectableLexicalKey],
    available_pos: frozenset[WinkPosTag],
) -> BenchmarkProfile:
    """Build a profile whose name states every varied graph dimension."""
    link_name = "lemma" if lemmatized else "raw"
    fields_name = "glosses" if lexical_fields == GLOSSES_ONLY else "all-fields"
    pos_name = "all-pos" if available_pos == ALL_POS else "collide-pos"
    return BenchmarkProfile(
        name=f"{link_name}__{fields_name}__{pos_name}",
        edge_constraints=EdgeConstraints(
            lemmatized=lemmatized,
            available_lexical_fields=lexical_fields,
            available_pos=available_pos,
        ),
    )


def screening_profiles() -> tuple[BenchmarkProfile, ...]:
    """Return the complete two-by-two-by-two screening profile grid."""
    return tuple(
        make_profile(lemmatized, lexical_fields, available_pos)
        for lemmatized in (True, False)
        for lexical_fields in (GLOSSES_ONLY, ALL_LEXICAL_FIELDS)
        for available_pos in (ALL_POS, COLLIDE_AVAILABLE_POS)
    )


def final_profiles(mode: SearchMode) -> tuple[BenchmarkProfile, ...]:
    """Return game-realistic lemma and raw profiles for one search mode."""
    available_pos = ALL_POS if mode == "regular" else COLLIDE_AVAILABLE_POS
    return tuple(
        make_profile(
            lemmatized,
            GLOSSES_ONLY,
            available_pos,
        )
        for lemmatized in (True, False)
    )


def _learned_astar(
    name: str,
    *,
    heuristic_weight: float = 1.0,
    unreachable_penalty: float = 0.0,
) -> BenchmarkAlgorithm:
    """Build one named learned A-star benchmark configuration."""
    return BenchmarkAlgorithm(
        name=name,
        search=GeneralizedShortestPathSearch.best_first_search(
            scorer=AStarScorer(
                LearnedCostHeuristic(
                    unreachable_penalty=unreachable_penalty,
                ),
                heuristic_weight=heuristic_weight,
            ),
        ),
        uses_learned_model=True,
    )


def _embedding_astar(
    name: str,
    *,
    heuristic_weight: float = 1.0,
    batch_size: int = 1,
) -> BenchmarkAlgorithm:
    """Build one named embedding A-star benchmark configuration."""
    return BenchmarkAlgorithm(
        name=name,
        search=GeneralizedShortestPathSearch(
            scorer=AStarScorer(
                EmbeddingSimilarityHeuristic(),
                heuristic_weight=heuristic_weight,
            ),
            batch_size=batch_size,
        ),
    )


def regular_algorithms() -> tuple[BenchmarkAlgorithm, ...]:
    """Return every regular-search configuration in broad screening."""
    return (
        BenchmarkAlgorithm(
            "breadth-first",
            GeneralizedShortestPathSearch.best_first_search(
                scorer=BreadthFirstScorer(),
            ),
        ),
        BenchmarkAlgorithm(
            "embedding-global-greedy",
            GeneralizedShortestPathSearch.best_first_search(
                scorer=GreedyScorer(EmbeddingSimilarityHeuristic()),
            ),
        ),
        _embedding_astar("embedding-a-star-w1"),
        _embedding_astar(
            "embedding-a-star-w1-b16",
            batch_size=16,
        ),
        _embedding_astar(
            "embedding-a-star-w2-b16",
            heuristic_weight=2.0,
            batch_size=16,
        ),
        BenchmarkAlgorithm(
            "learned-global-greedy",
            GeneralizedShortestPathSearch.best_first_search(
                scorer=GreedyScorer(LearnedCostHeuristic()),
            ),
            uses_learned_model=True,
        ),
        _learned_astar(
            "learned-a-star-w0.5-p0",
            heuristic_weight=0.5,
        ),
        _learned_astar("learned-a-star-w1-p0"),
        _learned_astar(
            "learned-a-star-w1-p1",
            unreachable_penalty=1.0,
        ),
        _learned_astar(
            "learned-a-star-w1-p3",
            unreachable_penalty=3.0,
        ),
    )


def collide_algorithms() -> tuple[BenchmarkAlgorithm, ...]:
    """Return fixed-root collide screening configurations."""
    return (
        BenchmarkAlgorithm(
            "breadth-first",
            GeneralizedShortestPathSearch.best_first_search(
                scorer=BreadthFirstScorer(),
            ),
        ),
        BenchmarkAlgorithm(
            "embedding-a-star-w1",
            GeneralizedShortestPathSearch.best_first_search(
                scorer=AStarScorer(EmbeddingSimilarityHeuristic()),
            ),
        ),
        _learned_astar("learned-a-star-w1-p0"),
        _learned_astar(
            "learned-a-star-w1-p1",
            unreachable_penalty=1.0,
        ),
        _learned_astar(
            "learned-a-star-w1-p3",
            unreachable_penalty=3.0,
        ),
        _learned_astar(
            "learned-a-star-w0.5-p0",
            heuristic_weight=0.5,
        ),
    )


def select_algorithms(
    algorithms: Sequence[BenchmarkAlgorithm],
    selected_names: Collection[str],
) -> tuple[BenchmarkAlgorithm, ...]:
    """Return manually selected algorithms and reject unknown names."""
    algorithms_by_name = {algorithm.name: algorithm for algorithm in algorithms}
    unknown_names = set(selected_names).difference(algorithms_by_name)
    if unknown_names:
        raise ValueError(f"Unknown benchmark algorithms: {sorted(unknown_names)}.")
    return tuple(algorithms_by_name[name] for name in selected_names)


async def _sample_embedding_words(
    session: AsyncSession,
    sample_size: int,
    rng: np.random.Generator,
    word_pattern: str,
) -> tuple[str, ...]:
    """Return a repeatable PostgreSQL sample of embedded ordinary words."""
    await session.execute(select(func.setseed(float(rng.uniform(-1.0, 1.0)))))
    rows = await session.execute(
        select(Embeddings.word)
        .where(Embeddings.word.op("~")(word_pattern))
        .order_by(func.random())
        .limit(sample_size)
    )
    return tuple(rows.scalars())


async def generate_regular_cases(
    session: AsyncSession,
    profile: BenchmarkProfile,
    case_count: int,
    *,
    rng_seed: int = 42,
    min_path_length: int = 2,
    max_cost: int = 8,
    word_pattern: str = "^[a-z]{4,12}$",
    pool_factor: int = 4,
    max_attempts: int = 8,
) -> list[tuple[str, str]]:
    """Sample embedded endpoint pairs with exact regular paths in a cost range.

    Args:
        session: Database session used to sample words with embeddings.
        profile: Complete constraints used for exact path validation.
        case_count: Number of unique endpoint pairs to return.
        rng_seed: NumPy and PostgreSQL sampling seed.
        min_path_length: Minimum exact graph-link count, inclusive.
        max_cost: Exclusive exact graph-link-count limit.
        word_pattern: PostgreSQL regular expression for candidate words.
        pool_factor: Sampled-word multiplier per requested case.
        max_attempts: Maximum independent database samples.

    Returns:
        Up to ``case_count`` deterministic, exact-range endpoint pairs.
    """
    if case_count <= 0:
        raise ValueError("case_count must be positive.")
    if min_path_length >= max_cost:
        raise ValueError("min_path_length must be lower than max_cost.")

    exact_search = IgraphSearch()
    rng = np.random.default_rng(rng_seed)
    sample_size = max(case_count * pool_factor, 64)
    cases: list[tuple[str, str]] = []
    seen_cases: set[tuple[str, str]] = set()

    # Matrix distances validate a complete sample in one igraph operation.
    for _ in range(max_attempts):
        words = await _sample_embedding_words(
            session,
            sample_size,
            rng,
            word_pattern,
        )
        distances = exact_search.distance_matrix(
            words,
            words,
            profile.edge_constraints,
        )
        valid_indices = np.argwhere(
            np.isfinite(distances)
            & (distances >= min_path_length)
            & (distances < max_cost)
        )
        rng.shuffle(valid_indices)

        for start_index, target_index in valid_indices:
            case = (words[start_index], words[target_index])
            if case in seen_cases:
                continue
            seen_cases.add(case)
            cases.append(case)
            if len(cases) == case_count:
                return cases

    return cases


async def generate_collide_cases(
    session: AsyncSession,
    profile: BenchmarkProfile,
    case_count: int,
    *,
    rng_seed: int = 42,
    min_combined_length: int = 2,
    max_combined_length: int = 8,
    word_pattern: str = "^[a-z]{4,12}$",
    pool_factor: int = 4,
    max_attempts: int = 8,
) -> list[tuple[str, str]]:
    """Sample embedded endpoints whose exact collide solution moves both lanes.

    Args:
        session: Database session used to sample words with embeddings.
        profile: Complete constraints used for exact collide validation.
        case_count: Number of unique endpoint pairs to return.
        rng_seed: NumPy and PostgreSQL sampling seed.
        min_combined_length: Minimum links across both lanes, inclusive.
        max_combined_length: Maximum links across both lanes, inclusive.
        word_pattern: PostgreSQL regular expression for candidate words.
        pool_factor: Sampled-word multiplier per requested case.
        max_attempts: Maximum independent database samples.

    Returns:
        Up to ``case_count`` pairs whose lanes each move at least once.
    """
    if case_count <= 0:
        raise ValueError("case_count must be positive.")
    if min_combined_length > max_combined_length:
        raise ValueError("min_combined_length must not exceed max_combined_length.")

    exact_search = IgraphSearch()
    rng = np.random.default_rng(rng_seed)
    sample_size = max(case_count * pool_factor, 64)
    cases: list[tuple[str, str]] = []
    seen_cases: set[tuple[str, str]] = set()

    # Shuffle endpoint indices before exact collide checks to keep the accepted
    # pairs deterministic without favoring database row order.
    for _ in range(max_attempts):
        words = await _sample_embedding_words(
            session,
            sample_size,
            rng,
            word_pattern,
        )
        endpoint_indices = np.argwhere(~np.eye(len(words), dtype=bool))
        rng.shuffle(endpoint_indices)

        for start_index, target_index in endpoint_indices:
            case = (words[start_index], words[target_index])
            if case in seen_cases:
                continue
            seen_cases.add(case)

            result = await exact_search.search_collide(
                *case,
                edge_constraints=profile.edge_constraints,
            )
            if result is None:
                continue
            start_links = len(result.start_path) - 1
            target_links = len(result.target_path) - 1
            combined_links = start_links + target_links
            if (
                start_links >= 1
                and target_links >= 1
                and min_combined_length <= combined_links <= max_combined_length
            ):
                cases.append(case)
                if len(cases) == case_count:
                    return cases

    return cases


async def exact_cost(
    mode: SearchMode,
    exact_search: IgraphSearch,
    start: str,
    target: str,
    profile: BenchmarkProfile,
) -> int | None:
    """Return the exact regular or combined collide link count."""
    if mode == "regular":
        result = await exact_search.search_regular(
            start,
            target,
            edge_constraints=profile.edge_constraints,
        )
        return len(result.start_path) - 1 if result is not None else None

    result = await exact_search.search_collide(
        start,
        target,
        edge_constraints=profile.edge_constraints,
    )
    if result is None:
        return None
    return len(result.start_path) + len(result.target_path) - 2


async def _run_search(
    mode: SearchMode,
    algorithm: GeneralizedShortestPathSearch,
    start: str,
    target: str,
    profile: BenchmarkProfile,
    max_expansions: int,
) -> SearchResult | None:
    """Dispatch one benchmark call to the selected search mode."""
    if mode == "regular":
        return await algorithm.search_regular(
            start,
            target,
            edge_constraints=profile.edge_constraints,
            max_expansions=max_expansions,
        )
    return await algorithm.search_collide(
        start,
        target,
        edge_constraints=profile.edge_constraints,
        max_expansions=max_expansions,
    )


def _paths_and_cost(
    mode: SearchMode,
    result: SearchResult | None,
    target: str,
) -> tuple[
    tuple[str, ...] | None,
    tuple[str, ...] | None,
    int | None,
    int | None,
    bool,
]:
    """Extract lane paths, link counts, and endpoint validity."""
    if result is None:
        return None, None, None, None, False

    start_path = result.start_path
    start_links = len(start_path) - 1
    if mode == "regular":
        valid = bool(start_path) and start_path[-1] == target.lower()
        return start_path, None, start_links, None, valid

    if not isinstance(result, CollideSearchResult):
        raise TypeError("Collide search returned a regular result.")
    target_path = result.target_path
    target_links = len(target_path) - 1
    valid = bool(start_path) and bool(target_path) and start_path[-1] == target_path[-1]
    return start_path, target_path, start_links, target_links, valid


async def benchmark_case(
    *,
    stage: str,
    mode: SearchMode,
    profile: BenchmarkProfile,
    algorithm: BenchmarkAlgorithm,
    start: str,
    target: str,
    shortest_cost: int | None,
    max_expansions: int,
) -> BenchmarkResult:
    """Time one search and preserve failures as benchmark data.

    Args:
        stage: Benchmark stage written to the result row.
        mode: Regular or collide dispatch mode.
        profile: Graph constraints and their display name.
        algorithm: Named search configuration under test.
        start: First endpoint word.
        target: Regular destination or second collide root.
        shortest_cost: Exact igraph link count, or ``None`` when unreachable.
        max_expansions: Expansion budget passed to the search operation.

    Returns:
        Timed result row containing paths, exact-cost comparison, and any
        exception text. Search exceptions do not escape this function.
    """
    started_at = time.perf_counter()
    error: str | None = None

    try:
        result = await _run_search(
            mode,
            algorithm.search,
            start,
            target,
            profile,
            max_expansions,
        )
        (
            start_path,
            target_path,
            start_links,
            target_links,
            valid,
        ) = _paths_and_cost(mode, result, target)
        status: BenchmarkStatus = "success" if valid else "no_route"
    except Exception as exception:
        logger.exception(
            "Benchmark error in %s/%s/%s: %s -> %s",
            mode,
            profile.name,
            algorithm.name,
            start,
            target,
        )
        start_path = target_path = None
        start_links = target_links = None
        status = "error"
        error = f"{type(exception).__name__}: {exception}"

    duration_ms = (time.perf_counter() - started_at) * 1000
    combined_links = (
        start_links + (target_links or 0) if start_links is not None else None
    )
    optimality = (
        shortest_cost / combined_links
        if shortest_cost is not None and combined_links
        else 1.0
        if shortest_cost == combined_links == 0
        else None
    )
    constraints = profile.edge_constraints
    return BenchmarkResult(
        stage=stage,
        mode=mode,
        profile=profile.name,
        algorithm=algorithm.name,
        max_cost=algorithm.search.max_cost,
        lemmatized=constraints.lemmatized,
        lexical_fields=",".join(
            sorted(field.value for field in constraints.available_lexical_fields)
        ),
        available_pos=",".join(sorted(pos.value for pos in constraints.available_pos)),
        start_word=start,
        target_word=target,
        status=status,
        start_path=start_path,
        target_path=target_path,
        start_links=start_links,
        target_links=target_links,
        combined_links=combined_links,
        exact_cost=shortest_cost,
        optimality=optimality,
        duration_ms=duration_ms,
        error=error,
    )


async def warm_learned_algorithms(
    mode: SearchMode,
    profile: BenchmarkProfile,
    algorithms: Sequence[BenchmarkAlgorithm],
    warmup_case: tuple[str, str],
    max_expansions: int,
) -> None:
    """Warm learned configurations before recording suite latency.

    Args:
        mode: Search operation used by the measured suite.
        profile: Graph constraints used by the measured suite.
        algorithms: Configurations whose learned models may require warmup.
        warmup_case: Endpoint pair excluded from recorded results.
        max_expansions: Expansion budget used for warmup searches.
    """
    start, target = warmup_case
    for algorithm in algorithms:
        if not algorithm.uses_learned_model:
            continue

        # Warm each model/configuration under the same mode and constraints that
        # the timed suite uses; failures are logged and retried as measured data.
        try:
            await _run_search(
                mode,
                algorithm.search,
                start,
                target,
                profile,
                max_expansions,
            )
        except Exception:
            logger.exception(
                "Learned benchmark warmup failed for %s/%s/%s.",
                mode,
                profile.name,
                algorithm.name,
            )


async def run_benchmark(
    *,
    stage: str,
    mode: SearchMode,
    profile: BenchmarkProfile,
    algorithms: Sequence[BenchmarkAlgorithm],
    test_cases: Sequence[tuple[str, str]],
    max_expansions: int,
    warmup_case: tuple[str, str],
) -> list[BenchmarkResult]:
    """Run one mode/profile suite against an exact igraph baseline.

    Args:
        stage: Benchmark stage written to every result.
        mode: Regular or collide search mode.
        profile: Graph constraints shared by exact and database searches.
        algorithms: Named database search configurations to compare.
        test_cases: Endpoint pairs evaluated by every algorithm.
        max_expansions: Expansion budget for each database search.
        warmup_case: Endpoint pair used to initialize learned models.

    Returns:
        One raw result for every test-case and algorithm combination.
    """
    exact_search = IgraphSearch()
    results: list[BenchmarkResult] = []
    await warm_learned_algorithms(
        mode,
        profile,
        algorithms,
        warmup_case,
        max_expansions,
    )

    # Calculate the exact cost once per case/profile, then compare every
    # configured database search against that same baseline.
    for start, target in tqdm(
        test_cases,
        desc=f"{stage} {mode} {profile.name}",
    ):
        shortest_cost = await exact_cost(
            mode,
            exact_search,
            start,
            target,
            profile,
        )
        for algorithm in algorithms:
            results.append(
                await benchmark_case(
                    stage=stage,
                    mode=mode,
                    profile=profile,
                    algorithm=algorithm,
                    start=start,
                    target=target,
                    shortest_cost=shortest_cost,
                    max_expansions=max_expansions,
                )
            )
    return results


def summarize_results(
    results: Sequence[BenchmarkResult],
) -> list[ComparisonSummary]:
    """Aggregate comparable benchmark rows.

    Args:
        results: Raw rows from one or more benchmark suites.

    Returns:
        Metrics grouped by stage, mode, profile, algorithm, and maximum cost.
    """
    grouped: dict[
        tuple[str, SearchMode, str, str, float],
        list[BenchmarkResult],
    ] = defaultdict(list)
    for result in results:
        grouped[
            (
                result.stage,
                result.mode,
                result.profile,
                result.algorithm,
                result.max_cost,
            )
        ].append(result)

    summaries: list[ComparisonSummary] = []
    for key, group in grouped.items():
        stage, mode, profile, algorithm, max_cost = key
        reachable = [result for result in group if result.exact_cost is not None]
        successes = [result for result in reachable if result.status == "success"]
        measured_durations = [
            result.duration_ms for result in group if result.status != "error"
        ]
        path_lengths = [
            result.combined_links
            for result in successes
            if result.combined_links is not None
        ]
        optimalities = [
            result.optimality for result in successes if result.optimality is not None
        ]

        # Percentiles are reported over all finite, non-exception search calls,
        # including exhausted no-route attempts.
        summaries.append(
            ComparisonSummary(
                stage=stage,
                mode=mode,
                profile=profile,
                algorithm=algorithm,
                max_cost=max_cost,
                total_cases=len(group),
                reachable_cases=len(reachable),
                successes=len(successes),
                reachable_success_rate=(
                    len(successes) / len(reachable) if reachable else 0.0
                ),
                mean_duration_ms=(
                    float(np.mean(measured_durations)) if measured_durations else 0.0
                ),
                p50_duration_ms=(
                    float(np.percentile(measured_durations, 50))
                    if measured_durations
                    else 0.0
                ),
                p95_duration_ms=(
                    float(np.percentile(measured_durations, 95))
                    if measured_durations
                    else 0.0
                ),
                mean_path_length=(float(np.mean(path_lengths)) if path_lengths else 0.0),
                mean_optimality=(float(np.mean(optimalities)) if optimalities else 0.0),
                exception_count=sum(result.status == "error" for result in group),
            )
        )
    return summaries


def rank_screening_finalists(
    results: Sequence[BenchmarkResult],
    mode: SearchMode,
    finalist_count: int = 3,
) -> tuple[str, ...]:
    """Rank exception-free algorithms across every screening profile.

    Args:
        results: Raw screening rows containing all compared profiles.
        mode: Search mode whose algorithms should be ranked.
        finalist_count: Number of algorithm names to return.

    Returns:
        Algorithm names ordered by reachable success rate, mean optimality,
        p95 latency, and finally name for deterministic ties.

    Raises:
        ValueError: If the requested count is invalid or too few algorithms
            completed without exceptions.
    """
    if finalist_count <= 0:
        raise ValueError("finalist_count must be positive.")

    groups: dict[str, list[BenchmarkResult]] = defaultdict(list)
    for result in results:
        if result.stage == "screening" and result.mode == mode:
            groups[result.algorithm].append(result)

    ranked: list[tuple[float, float, float, str]] = []
    for algorithm, group in groups.items():
        if any(result.status == "error" for result in group):
            continue
        reachable = [result for result in group if result.exact_cost is not None]
        successes = [result for result in reachable if result.status == "success"]
        optimalities = [
            result.optimality for result in successes if result.optimality is not None
        ]
        durations = [result.duration_ms for result in group]
        success_rate = len(successes) / len(reachable) if reachable else 0.0
        mean_optimality = float(np.mean(optimalities)) if optimalities else 0.0
        p95_latency = float(np.percentile(durations, 95)) if durations else math.inf
        ranked.append((-success_rate, -mean_optimality, p95_latency, algorithm))

    if len(ranked) < finalist_count:
        raise ValueError(
            f"Only {len(ranked)} exception-free {mode} algorithms are available."
        )
    return tuple(row[3] for row in sorted(ranked)[:finalist_count])


def write_csv(
    rows: Sequence[BenchmarkResult] | Sequence[ComparisonSummary],
    path: Path,
) -> None:
    """Write homogeneous benchmark dataclasses to one CSV file.

    Args:
        rows: Raw results or aggregate summaries of one consistent type.
        path: Destination CSV path; missing parent directories are created.

    Raises:
        ValueError: No rows were supplied.
    """
    if not rows:
        raise ValueError(f"Cannot write an empty benchmark CSV: {path}.")
    path.parent.mkdir(parents=True, exist_ok=True)
    first_row = rows[0]
    if isinstance(first_row, BenchmarkResult):
        serialized_rows = [
            result.to_csv_row() for result in rows if isinstance(result, BenchmarkResult)
        ]
    else:
        serialized_rows = [asdict(row) for row in rows]

    with path.open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=list(serialized_rows[0]),
        )
        writer.writeheader()
        writer.writerows(serialized_rows)


def read_benchmark_results(path: Path) -> list[BenchmarkResult]:
    """Read raw benchmark rows written by :func:`write_csv`.

    Args:
        path: Existing raw benchmark CSV file.

    Returns:
        Typed benchmark rows with JSON paths restored as tuples.
    """
    if not path.exists():
        return []

    results: list[BenchmarkResult] = []
    with path.open(encoding="utf-8", newline="") as csv_file:
        for row in csv.DictReader(csv_file):
            start_path = (
                tuple(json.loads(row["start_path"])) if row["start_path"] else None
            )
            target_path = (
                tuple(json.loads(row["target_path"])) if row["target_path"] else None
            )
            results.append(
                BenchmarkResult(
                    stage=row["stage"],
                    mode=cast(SearchMode, row["mode"]),
                    profile=row["profile"],
                    algorithm=row["algorithm"],
                    max_cost=float(row["max_cost"]),
                    lemmatized=row["lemmatized"] == "True",
                    lexical_fields=row["lexical_fields"],
                    available_pos=row["available_pos"],
                    start_word=row["start_word"],
                    target_word=row["target_word"],
                    status=cast(BenchmarkStatus, row["status"]),
                    start_path=start_path,
                    target_path=target_path,
                    start_links=(int(row["start_links"]) if row["start_links"] else None),
                    target_links=(
                        int(row["target_links"]) if row["target_links"] else None
                    ),
                    combined_links=(
                        int(row["combined_links"]) if row["combined_links"] else None
                    ),
                    exact_cost=int(row["exact_cost"]) if row["exact_cost"] else None,
                    optimality=(float(row["optimality"]) if row["optimality"] else None),
                    duration_ms=float(row["duration_ms"]),
                    error=row["error"] or None,
                )
            )
    return results


def write_benchmark_outputs(
    stage: str,
    results: Sequence[BenchmarkResult],
    output_dir: Path = BENCHMARK_OUTPUT_DIR,
) -> tuple[Path, Path]:
    """Write raw and aggregate CSV files for one benchmark stage.

    Args:
        stage: Filename prefix shared by both artifacts.
        results: Raw results to serialize and summarize.
        output_dir: Directory containing ignored benchmark artifacts.

    Returns:
        Raw-result and aggregate-summary paths, in that order.
    """
    summaries = summarize_results(results)
    raw_path = output_dir / f"{stage}_raw.csv"
    summary_path = output_dir / f"{stage}_summary.csv"
    write_csv(results, raw_path)
    write_csv(summaries, summary_path)
    return raw_path, summary_path


async def run_screening(
    session: AsyncSession,
) -> tuple[list[BenchmarkResult], list[ComparisonSummary]]:
    """Run or resume the broad 20-case, 300-expansion screening matrix.

    Args:
        session: Database session used to generate exact-range dynamic cases.

    Returns:
        Complete raw screening rows available on disk and their summaries.

    Raises:
        RuntimeError: Either search mode cannot supply 10 valid dynamic cases.
    """
    regular_dynamic = await generate_regular_cases(
        session,
        final_profiles("regular")[0],
        10,
        rng_seed=42,
    )
    collide_dynamic = await generate_collide_cases(
        session,
        final_profiles("collide")[0],
        10,
        rng_seed=42,
    )
    if len(regular_dynamic) != 10 or len(collide_dynamic) != 10:
        raise RuntimeError(
            "Could not generate 10 exact-range dynamic cases for both modes."
        )

    raw_path = BENCHMARK_OUTPUT_DIR / "screening_raw.csv"
    results = [
        result
        for result in read_benchmark_results(raw_path)
        if result.stage == "screening"
    ]
    mode_settings: tuple[
        tuple[
            SearchMode,
            Sequence[BenchmarkAlgorithm],
            Sequence[tuple[str, str]],
        ],
        ...,
    ] = (
        ("regular", regular_algorithms(), regular_dynamic),
        ("collide", collide_algorithms(), collide_dynamic),
    )

    # Each mode uses the same 10 curated cases plus 10 seeded dynamic cases
    # across all eight constraint profiles.
    for mode, algorithms, dynamic_cases in mode_settings:
        test_cases = (*DEFAULT_TEST_CASES, *dynamic_cases)
        for profile in screening_profiles():
            expected_rows = len(test_cases) * len(algorithms)
            completed_rows = [
                result
                for result in results
                if result.mode == mode and result.profile == profile.name
            ]
            if len(completed_rows) == expected_rows:
                logger.info(
                    "Resuming screening after completed %s/%s.",
                    mode,
                    profile.name,
                )
                continue

            # Discard a partial profile before rerunning it so every matrix cell
            # has one complete, comparable result set.
            results = [
                result
                for result in results
                if not (result.mode == mode and result.profile == profile.name)
            ]
            results.extend(
                await run_benchmark(
                    stage="screening",
                    mode=mode,
                    profile=profile,
                    algorithms=algorithms,
                    test_cases=test_cases,
                    max_expansions=300,
                    warmup_case=dynamic_cases[0],
                )
            )
            # Preserve completed profiles so an interrupted long screening run
            # can resume from evidence instead of losing every measured row.
            write_benchmark_outputs("screening", results)

    return results, summarize_results(results)


async def run_final_benchmarks(
    session: AsyncSession,
    *,
    regular_finalists: Collection[str],
    collide_finalists: Collection[str],
) -> tuple[list[BenchmarkResult], list[ComparisonSummary]]:
    """Run four 100-case game-realistic suites for screened finalists.

    Args:
        session: Database session used to generate exact-range dynamic cases.
        regular_finalists: Exactly three regular algorithm names.
        collide_finalists: Exactly three collide algorithm names.

    Returns:
        Raw results from all four suites and their summaries.

    Raises:
        ValueError: Either mode does not supply exactly three known finalists.
        RuntimeError: A suite cannot generate its 90 valid dynamic cases.

    Finalists are expected to be exception-free screening configurations ranked
    by success, optimality, and p95 latency.
    """
    if (
        len(regular_finalists) != 3
        or len(set(regular_finalists)) != 3
        or len(collide_finalists) != 3
        or len(set(collide_finalists)) != 3
    ):
        raise ValueError("Select exactly three distinct finalists for each mode.")

    selected_algorithms = {
        "regular": select_algorithms(
            regular_algorithms(),
            regular_finalists,
        ),
        "collide": select_algorithms(
            collide_algorithms(),
            collide_finalists,
        ),
    }
    results: list[BenchmarkResult] = []

    # Generate 90 profile-specific cases so every final suite has exact paths
    # from two links up to the exclusive configured cost limit.
    for mode in ("regular", "collide"):
        for profile in final_profiles(mode):
            dynamic_cases = (
                await generate_regular_cases(
                    session,
                    profile,
                    90,
                    rng_seed=42,
                )
                if mode == "regular"
                else await generate_collide_cases(
                    session,
                    profile,
                    90,
                    rng_seed=42,
                )
            )
            if len(dynamic_cases) != 90:
                raise RuntimeError(
                    f"Could not generate 90 final cases for {mode}/{profile.name}."
                )
            test_cases = (*DEFAULT_TEST_CASES, *dynamic_cases)
            results.extend(
                await run_benchmark(
                    stage="final",
                    mode=mode,
                    profile=profile,
                    algorithms=selected_algorithms[mode],
                    test_cases=test_cases,
                    max_expansions=1000,
                    warmup_case=dynamic_cases[0],
                )
            )
            # Final suites are expensive enough to persist after each complete
            # profile rather than waiting for all four suites to finish.
            write_benchmark_outputs("final", results)

    return results, summarize_results(results)
