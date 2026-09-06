"""Synthetic tests for weighted regular and collide frontier behavior."""

from __future__ import annotations

import math
import unittest
from collections.abc import Collection, Sequence
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from search_agent.search.contracts import EdgeConstraints
from search_agent.search.scoring import (
    AStarScorer,
    EmbeddingSimilarityHeuristic,
    LearnedCostHeuristic,
    NodeScores,
    Scorer,
    SearchNode,
    TargetBoundScorer,
)
from search_agent.search.search import (
    Frontier,
    GeneralizedShortestPathSearch,
    LinkReader,
    NodePair,
    SearchEdge,
    get_links,
    make_budgeted_link_reader,
)


class StaticPriorityScorer(Scorer):
    """Assign deterministic word priorities without database access."""

    def __init__(
        self,
        priorities: dict[str, float],
        *,
        is_lower_bound: bool = False,
    ) -> None:
        """Store priorities and their regular-search bound declaration."""
        self.priorities = priorities
        self._is_lower_bound = is_lower_bound

    async def bind_target(
        self,
        target: SearchNode,
        session: AsyncSession,
        edge_constraints: EdgeConstraints,
    ) -> TargetBoundScorer:
        """Return scoring independent of the session, settings, and target."""
        del target, session, edge_constraints

        async def score_nodes(
            nodes: Collection[SearchNode],
        ) -> NodeScores:
            return {node: self.priorities.get(node.word, node.cost) for node in nodes}

        return score_nodes

    @property
    def is_regular_lower_bound(self) -> bool:
        """Return the explicit bound declaration used by the test."""
        return self._is_lower_bound


class SearchInvariantTests(unittest.IsolatedAsyncioTestCase):
    """Verify frontier invariants on small deterministic weighted graphs."""

    async def test_database_links_are_normalized_before_deduplication(self) -> None:
        """Raw surface variants resolve to the lowercase dictionary vertex."""
        # Reproduce display-oriented raw targets that differ only by case.
        session = AsyncMock(spec=AsyncSession)
        db_result = MagicMock()
        db_result.tuples.return_value = (
            (
                "source",
                {
                    "w": {
                        "glosses": {
                            "NOUN": ("Having", "having", "Related"),
                        }
                    }
                },
            ),
        )
        session.execute.return_value = db_result

        # The database adapter establishes canonical vertex identity.
        links = await get_links(
            {"source"},
            session,
            EdgeConstraints(lemmatized=False),
        )

        # Case variants collapse before sorted SearchEdge construction.
        self.assertEqual(
            links,
            {
                "source": (
                    SearchEdge("having"),
                    SearchEdge("related"),
                )
            },
        )

    @staticmethod
    def make_reader(
        graph: dict[str, tuple[SearchEdge, ...]],
        calls: list[str] | None = None,
        *,
        max_expansions: int = 100,
    ) -> LinkReader:
        """Build a budgeted in-memory batch link reader."""
        remaining_expansions = max_expansions

        async def read_links(
            words: Sequence[str],
        ) -> tuple[dict[str, tuple[SearchEdge, ...]], bool]:
            nonlocal remaining_expansions
            word_batch = tuple(words)[:remaining_expansions]
            remaining_expansions -= len(word_batch)
            if calls is not None:
                calls.extend(word_batch)
            return (
                {word: graph.get(word, ()) for word in word_batch},
                remaining_expansions == 0,
            )

        return read_links

    async def bind_static_target(
        self,
        scorer: StaticPriorityScorer,
        target: SearchNode,
    ):
        """Bind a static scorer through the production preparation API."""
        return await scorer.bind_target(target, AsyncSession(), EdgeConstraints())

    async def test_late_cheaper_route_requeues_and_propagates(self) -> None:
        """A cheaper version of an expanded word must improve its descendants."""
        graph = {
            "start": (SearchEdge("shared", 5.0), SearchEdge("detour", 1.0)),
            "shared": (SearchEdge("target", 1.0),),
            "detour": (SearchEdge("shared", 1.0),),
        }
        scorer = StaticPriorityScorer({"shared": 0.0, "detour": 10.0})
        search = GeneralizedShortestPathSearch.best_first_search(
            scorer=scorer,
            max_cost=8.0,
        )
        target = SearchNode("target", 0.0, 0)
        node_scorer = await self.bind_static_target(scorer, target)

        # The expensive shared node reaches the target first; the detour then
        # replaces and re-expands it to produce the final cheaper target path.
        result = await search._search_regular(
            SearchNode("start", 0.0, 0),
            target.word,
            self.make_reader(graph),
            node_scorer,
        )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.path, ("start", "detour", "shared", "target"))
        self.assertEqual(result.cost, 3.0)
        self.assertEqual(result.depth, 3)

    async def test_frontier_updates_a_queued_word_in_place(self) -> None:
        """OPEN contains only the cheapest queued version of each word."""
        # Infinite scores remain valid when they are ordering-only.
        scorer = StaticPriorityScorer({"word": math.inf})
        node_scorer = await self.bind_static_target(
            scorer,
            SearchNode("target", 0.0, 0),
        )
        root = SearchNode("root", 0.0, 0)
        frontier = Frontier(root)
        cost_threshold = 8.0

        expensive = frontier.admit((SearchNode("word", 5.0, 1, root),), cost_threshold)
        await frontier.enqueue(
            expensive,
            node_scorer,
            cost_threshold=cost_threshold,
        )
        cheaper = SearchNode("word", 2.0, 2, root)
        admitted = frontier.admit((cheaper,), cost_threshold)
        await frontier.enqueue(
            admitted,
            node_scorer,
            cost_threshold=cost_threshold,
        )

        self.assertEqual(len(frontier._open), 1)
        self.assertEqual(
            frontier.pop_batch(1, cost_threshold=cost_threshold),
            (cheaper,),
        )
        self.assertFalse(frontier)

    async def test_max_cost_is_an_exclusive_solution_limit(self) -> None:
        """A result below max_cost is valid while equality is rejected."""
        calls: list[str] = []
        graph = {
            "start": (
                SearchEdge("target", 7.0),
                SearchEdge("exact-limit", 8.0),
            ),
            "target": (SearchEdge("beyond"),),
        }
        scorer = StaticPriorityScorer({})
        search = GeneralizedShortestPathSearch.best_first_search(
            scorer=scorer,
            max_cost=8.0,
        )
        target = SearchNode("target", 0.0, 0)

        result = await search._search_regular(
            SearchNode("start", 0.0, 0),
            target.word,
            self.make_reader(graph, calls),
            await self.bind_static_target(scorer, target),
        )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual((result.cost, result.depth), (7.0, 1))
        self.assertEqual(calls, ["start"])

        exact_calls: list[str] = []
        exact_limit = await search._search_regular(
            SearchNode("start", 0.0, 0),
            "exact-limit",
            self.make_reader(graph, exact_calls),
            await self.bind_static_target(
                scorer,
                SearchNode("exact-limit", 0.0, 0),
            ),
        )
        self.assertIsNone(exact_limit)
        self.assertEqual(exact_calls, ["start"])

    async def test_mid_batch_exhaustion_preserves_completed_children(self) -> None:
        """Children from earlier batch expansions survive budget exhaustion."""
        graph = {
            "first": (SearchEdge("child"),),
            "second": (SearchEdge("lost"),),
        }
        batches: list[tuple[str, ...]] = []

        async def read_links(
            words: set[str],
            session: AsyncSession,
            edge_constraints: EdgeConstraints,
        ) -> dict[str, tuple[SearchEdge, ...]]:
            del session, edge_constraints
            self.assertEqual(words, {"first"})
            word_batch = tuple(words)
            batches.append(word_batch)
            return {word: graph.get(word, ()) for word in word_batch}

        with patch("search_agent.search.search.get_links", read_links):
            reader = make_budgeted_link_reader(
                AsyncSession(),
                max_expansions=1,
                edge_constraints=EdgeConstraints(),
            )
            children, exhausted = await GeneralizedShortestPathSearch._expand_batch(
                (SearchNode("first", 0.0, 0), SearchNode("second", 0.0, 0)),
                reader,
            )

        self.assertTrue(exhausted)
        self.assertEqual([child.word for child in children], ["child"])
        self.assertEqual(batches, [("first",)])

    async def test_expansion_reads_a_popped_batch_at_once(self) -> None:
        """One link-reader call serves every node in a popped batch."""
        batches: list[tuple[str, ...]] = []

        async def read_links(
            words: Sequence[str],
        ) -> tuple[dict[str, tuple[SearchEdge, ...]], bool]:
            word_batch = tuple(words)
            batches.append(word_batch)
            return (
                {word: (SearchEdge(f"{word}-child"),) for word in word_batch},
                False,
            )

        children, exhausted = await GeneralizedShortestPathSearch._expand_batch(
            (SearchNode("first", 0.0, 0), SearchNode("second", 0.0, 0)),
            read_links,
        )

        self.assertFalse(exhausted)
        self.assertEqual(batches, [("first", "second")])
        self.assertEqual(
            [child.word for child in children],
            ["first-child", "second-child"],
        )

    async def test_collide_replaces_an_expensive_collision(self) -> None:
        """Fixed-root collide search retains the cheapest discovered meeting."""
        graph = {
            "start": (SearchEdge("early", 5.0), SearchEdge("left", 1.0)),
            "target": (SearchEdge("early", 4.0), SearchEdge("right", 1.0)),
            "left": (SearchEdge("meeting", 1.0),),
            "right": (SearchEdge("meeting", 1.0),),
        }
        priorities = {
            "start": 0.0,
            "target": 0.0,
            "early": 0.0,
            "left": 10.0,
            "right": 10.0,
            "meeting": 20.0,
        }
        roots = NodePair(
            SearchNode("start", 0.0, 0),
            SearchNode("target", 0.0, 0),
        )

        # Even a regular-search lower-bound declaration cannot turn priorities
        # toward the opposite root into common-descendant solution bounds.
        scorer = StaticPriorityScorer(priorities, is_lower_bound=True)
        search = GeneralizedShortestPathSearch.best_first_search(
            scorer=scorer,
            max_cost=10.0,
        )
        solution = await search._search_collide(
            roots,
            self.make_reader(graph),
            await self.bind_static_target(scorer, roots.target),
            await self.bind_static_target(scorer, roots.start),
        )

        self.assertIsNotNone(solution)
        assert solution is not None
        self.assertEqual(solution.cost, 4.0)
        self.assertEqual(solution.start.word, "meeting")
        self.assertEqual(solution.target.word, "meeting")

    async def test_beam_trim_retains_best_eligible_open_entries(self) -> None:
        """Beam trimming selects K eligible words from the exact OPEN set."""
        root = SearchNode("root", 0.0, 0)
        frontier = Frontier(root)
        cost_threshold = 8.0

        async def prefer_expensive_nodes(
            nodes: Collection[SearchNode],
        ) -> NodeScores:
            return {node: -node.cost for node in nodes}

        first = frontier.admit((SearchNode("requeued", 5.0, 1, root),), cost_threshold)
        await frontier.enqueue(
            first,
            prefer_expensive_nodes,
            cost_threshold=cost_threshold,
        )
        replacement = SearchNode("requeued", 2.0, 2, root)
        other = SearchNode("other", 1.0, 1, root)
        over_bound = SearchNode("over-bound", 6.0, 1, root)
        admitted = frontier.admit(
            (replacement, other, over_bound),
            cost_threshold,
        )
        await frontier.enqueue(
            admitted,
            prefer_expensive_nodes,
            cost_threshold=cost_threshold,
        )

        frontier.trim_queue(None, cost_threshold=cost_threshold)
        self.assertEqual(len(frontier._open), 3)

        frontier.trim_queue(2, cost_threshold=4.0)
        self.assertEqual(
            frontier.pop_batch(None, cost_threshold=cost_threshold),
            (replacement, other),
        )

    async def test_admissible_score_at_max_cost_is_pruned(self) -> None:
        """A lower bound equal to the exclusive limit cannot produce a result."""
        calls: list[str] = []
        graph = {
            "start": (SearchEdge("boundary", 1.0),),
            "boundary": (SearchEdge("target", 7.0),),
        }
        scorer = StaticPriorityScorer(
            {"boundary": 8.0},
            is_lower_bound=True,
        )
        search = GeneralizedShortestPathSearch.best_first_search(scorer, max_cost=8.0)
        target = SearchNode("target", 0.0, 0)

        result = await search._search_regular(
            SearchNode("start", 0.0, 0),
            target.word,
            self.make_reader(graph, calls),
            await self.bind_static_target(scorer, target),
        )

        self.assertIsNone(result)
        self.assertEqual(calls, ["start"])

    async def test_only_declared_regular_bounds_gate_priorities(self) -> None:
        """An incumbent priority cutoff requires an admissible scorer."""
        graph = {
            "start": (SearchEdge("target", 5.0), SearchEdge("detour", 1.0)),
            "detour": (SearchEdge("tail", 1.0),),
        }
        expansion_calls: dict[bool, list[str]] = {}

        # A declared lower bound may drop the priority-five detour after finding
        # an equal-cost incumbent; an ordering-only scorer keeps exploring it.
        for is_lower_bound in (True, False):
            scorer = StaticPriorityScorer(
                {"detour": 5.0, "tail": 5.0},
                is_lower_bound=is_lower_bound,
            )
            search = GeneralizedShortestPathSearch.best_first_search(
                scorer=scorer,
                max_cost=8.0,
            )
            calls: list[str] = []
            target = SearchNode("target", 0.0, 0)
            result = await search._search_regular(
                SearchNode("start", 0.0, 0),
                target.word,
                self.make_reader(graph, calls),
                await self.bind_static_target(scorer, target),
            )
            self.assertIsNotNone(result)
            expansion_calls[is_lower_bound] = calls

        self.assertEqual(expansion_calls[True], ["start"])
        self.assertEqual(expansion_calls[False], ["start", "detour", "tail"])

        # Production learned and embedding heuristics remain conservative unless
        # a caller explicitly establishes admissibility.
        self.assertFalse(AStarScorer(LearnedCostHeuristic()).is_regular_lower_bound)
        self.assertFalse(
            AStarScorer(EmbeddingSimilarityHeuristic()).is_regular_lower_bound
        )
        self.assertTrue(
            AStarScorer(
                EmbeddingSimilarityHeuristic(is_admissible=True)
            ).is_regular_lower_bound
        )

    def test_negative_expansion_budget_is_rejected(self) -> None:
        """The database-reader boundary rejects a negative word budget."""
        with self.assertRaises(ValueError):
            make_budgeted_link_reader(
                AsyncSession(),
                max_expansions=-1,
                edge_constraints=EdgeConstraints(),
            )


if __name__ == "__main__":
    unittest.main()
