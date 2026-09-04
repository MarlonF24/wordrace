"""FastAPI export and Typer command-line entrypoint for search benchmarks."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Annotated

import typer
import uvicorn

# Re-export the application for FastAPI CLI discovery.
from search_agent.api import app
from search_agent.db import ASYNC_SESSION_MAKER
from search_agent.ENV import ENV
from search_agent.search.benchmark import (
    ComparisonSummary,
    collide_algorithms,
    rank_screening_finalists,
    regular_algorithms,
    run_final_benchmarks,
    run_screening,
)


DEFAULT_REGULAR_FINALISTS = (
    "embedding-a-star-w2-b16",
    "embedding-a-star-w1",
    "embedding-a-star-w1-b16",
)
DEFAULT_COLLIDE_FINALISTS = (
    "breadth-first",
    "embedding-a-star-w1",
    "learned-a-star-w1-p1",
)

cli = typer.Typer(
    no_args_is_help=True,
    help="Run the staged WordRace search benchmarks.",
)


@cli.command()
def serve() -> None:
    """Run the search API using its typed host and port configuration."""
    uvicorn.run(app, host=ENV.api_host, port=ENV.api_port)


def print_summaries(summaries: Sequence[ComparisonSummary]) -> None:
    """Print metrics used to compare benchmark configurations.

    Args:
        summaries: Aggregate rows to render as a fixed-width table.
    """
    header = (
        f"{'Mode/Profile/Algorithm':<88} "
        f"{'Solved':>9} {'Success':>8} {'Mean':>9} {'P50':>9} "
        f"{'P95':>9} {'Links':>7} {'Opt.':>7} {'Err':>4}"
    )
    print(header)
    print("-" * len(header))
    for summary in summaries:
        name = (
            f"{summary.mode}/{summary.profile}/{summary.algorithm}"
            f"/max-{summary.max_cost:g}"
        )
        print(
            f"{name:<88} "
            f"{summary.successes:>4}/{summary.reachable_cases:<4} "
            f"{summary.reachable_success_rate:>7.1%} "
            f"{summary.mean_duration_ms:>9.1f} "
            f"{summary.p50_duration_ms:>9.1f} "
            f"{summary.p95_duration_ms:>9.1f} "
            f"{summary.mean_path_length:>7.2f} "
            f"{summary.mean_optimality:>7.1%} "
            f"{summary.exception_count:>4}"
        )


async def _execute_screening() -> None:
    """Run screening and print aggregate metrics and ranked finalists."""
    async with ASYNC_SESSION_MAKER() as session:
        results, summaries = await run_screening(session)

    print(
        "Regular finalists:",
        ", ".join(rank_screening_finalists(results, "regular")),
    )
    print(
        "Collide finalists:",
        ", ".join(rank_screening_finalists(results, "collide")),
    )
    print_summaries(summaries)


@cli.command()
def screening() -> None:
    """Run or resume the broad screening matrix."""
    asyncio.run(_execute_screening())


async def _execute_final(
    regular_finalists: Sequence[str],
    collide_finalists: Sequence[str],
) -> None:
    """Run the four finalist suites and print aggregate metrics."""
    async with ASYNC_SESSION_MAKER() as session:
        _, summaries = await run_final_benchmarks(
            session,
            regular_finalists=regular_finalists,
            collide_finalists=collide_finalists,
        )
    print_summaries(summaries)


@cli.command("final")
def final_benchmarks(
    regular_finalist: Annotated[
        list[str] | None,
        typer.Option(
            "--regular-finalist",
            metavar="ALGORITHM",
            help="Regular finalist to run. Repeat exactly three times.",
        ),
    ] = None,
    collide_finalist: Annotated[
        list[str] | None,
        typer.Option(
            "--collide-finalist",
            metavar="ALGORITHM",
            help="Collide finalist to run. Repeat exactly three times.",
        ),
    ] = None,
) -> None:
    """Run the four 100-case suites for three finalists per search mode."""
    regular_finalists = regular_finalist or list(DEFAULT_REGULAR_FINALISTS)
    collide_finalists = collide_finalist or list(DEFAULT_COLLIDE_FINALISTS)

    # Validate selections before starting any expensive database work so Typer
    # can report option errors without masking runtime failures.
    if len(regular_finalists) != 3 or len(set(regular_finalists)) != 3:
        raise typer.BadParameter(
            "Select exactly three distinct regular finalists.",
            param_hint="--regular-finalist",
        )
    if len(collide_finalists) != 3 or len(set(collide_finalists)) != 3:
        raise typer.BadParameter(
            "Select exactly three distinct collide finalists.",
            param_hint="--collide-finalist",
        )

    available_regular = {algorithm.name for algorithm in regular_algorithms()}
    available_collide = {algorithm.name for algorithm in collide_algorithms()}
    unknown_regular = set(regular_finalists).difference(available_regular)
    unknown_collide = set(collide_finalists).difference(available_collide)
    if unknown_regular:
        raise typer.BadParameter(
            f"Unknown regular finalists: {sorted(unknown_regular)}.",
            param_hint="--regular-finalist",
        )
    if unknown_collide:
        raise typer.BadParameter(
            f"Unknown collide finalists: {sorted(unknown_collide)}.",
            param_hint="--collide-finalist",
        )

    asyncio.run(_execute_final(regular_finalists, collide_finalists))


if __name__ == "__main__":
    cli()
