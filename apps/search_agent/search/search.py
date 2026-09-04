"""Database-backed constrained traversal of the dictionary word graph."""

from __future__ import annotations

import math
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import NamedTuple, Self, final

from pqdict import pqdict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from search_agent.db import ASYNC_SESSION_MAKER, Dictionary
from search_agent.search.contracts import (
    CollideSearchResult,
    EdgeConstraints,
    RegularSearchResult,
)
from search_agent.search.scoring import (
    Scorer,
    SearchNode,
    TargetBoundScorer,
)


MIN_EDGE_COST = 1.0


class SearchEdge(NamedTuple):
    """Represent one outgoing graph transition.

    Attributes:
        target: Word reached by the transition.
        cost: Finite transition cost no smaller than ``MIN_EDGE_COST``. Link
            readers must uphold this contract.
    """

    target: str
    cost: float = MIN_EDGE_COST


type LinkBatch = dict[str, tuple[SearchEdge, ...]]
type LinkReader = Callable[
    [Sequence[str]],
    Awaitable[tuple[LinkBatch, bool]],
]


async def get_links(
    words: set[str],
    session: AsyncSession,
    edge_constraints: EdgeConstraints,
) -> LinkBatch:
    """Read legal outgoing dictionary edges for a batch of source words.

    Args:
        words: Unique source words whose stored links are read. Their order has
            no effect on the returned source-keyed mapping.
        session: Database session used for the dictionary query.
        edge_constraints: Link representation, lexical fields, and target POS
            buckets admitted by the traversal.

    Returns:
        Found source words mapped to deduplicated, target-sorted, unit-cost
        edges. Missing dictionary words are omitted.
    """
    if not words:
        return {}

    db_result = await session.execute(
        select(Dictionary.word, Dictionary.all_links).where(Dictionary.word.in_(words))
    )
    links_by_word: LinkBatch = {}

    # Extract each source independently while the database query remains batched.
    for word, all_links in db_result.tuples():
        links: set[str] = set()
        lexical_fields: dict[str, dict[str, tuple[str, ...]]] = (all_links or {}).get(
            edge_constraints.link_field, {}
        )
        for lexical_field in edge_constraints.available_lexical_fields:
            pos_links = lexical_fields.get(lexical_field.value, {})
            for pos in edge_constraints.available_pos:
                links.update(pos_links.get(pos.value, ()))

        links_by_word[word] = tuple(SearchEdge(target) for target in sorted(links))

    return links_by_word


def validate_max_expansions(max_expansions: int) -> None:
    """Reject a negative outgoing-link read budget."""
    if max_expansions < 0:
        raise ValueError("max_expansions must be non-negative.")


def make_budgeted_link_reader(
    session: AsyncSession,
    max_expansions: int,
    edge_constraints: EdgeConstraints,
) -> LinkReader:
    """Bind database settings and a private, shared word budget.

    Args:
        session: Database session shared by the search operation.
        max_expansions: Maximum number of source words to expand.
        edge_constraints: Constraints applied to every outgoing-edge query.

    Returns:
        Reader that truncates a batch at the remaining word budget and reports
        when that budget is exhausted.

    Raises:
        ValueError: ``max_expansions`` is negative.
    """
    validate_max_expansions(max_expansions)
    remaining_expansions = max_expansions

    async def read_links(words: Sequence[str]) -> tuple[LinkBatch, bool]:
        nonlocal remaining_expansions
        if not words:
            return {}, remaining_expansions == 0

        expanded_words = tuple(words)[:remaining_expansions]
        remaining_expansions -= len(expanded_words)
        # Budget selection remains ordered; deduplication happens only after the
        # exact prefix of source words has been chosen.
        edges_by_word = (
            await get_links(set(expanded_words), session, edge_constraints)
            if expanded_words
            else {}
        )
        return edges_by_word, remaining_expansions == 0

    return read_links


class NodePair(NamedTuple):
    """Pair the two lane nodes that form a collide solution.

    Attributes:
        start: Meeting node reached from the start root.
        target: Same meeting word reached from the target root.
    """

    start: SearchNode
    target: SearchNode

    @property
    def cost(self) -> float:
        """Return the combined cost of both solution lanes."""
        return self.start.cost + self.target.cost


@dataclass(slots=True, eq=False)
class Frontier:
    """Track one lane's cheapest discovered paths and exact OPEN set.

    ``best_by_word`` retains the cheapest discovered node for each word,
    including expanded and beam-trimmed words. ``_open`` is an indexed priority
    queue containing each currently expandable word at most once.

    Attributes:
        root: Zero-cost root node for this search lane.
        best_by_word: Cheapest discovered node keyed by word.
    """

    root: SearchNode
    _open: pqdict[str, float] = field(
        default_factory=pqdict[str, float],
        init=False,
    )
    best_by_word: dict[str, SearchNode] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        """Seed the frontier's discovered state with its root node."""
        self.best_by_word[self.root.word] = self.root

    def __bool__(self) -> bool:
        """Return whether this frontier has a word in its OPEN set."""
        return bool(self._open)

    @property
    def minimum_priority(self) -> float:
        """Return the best OPEN score or infinity when exhausted."""
        priority = self._open.topvalue(None)
        return priority if priority is not None else float("inf")

    def admit(
        self,
        nodes: Iterable[SearchNode],
        cost_threshold: float,
    ) -> tuple[SearchNode, ...]:
        """Record strict path improvements within the current threshold.

        Args:
            nodes: Candidate path versions produced by expansion.
            cost_threshold: Exclusive bound on useful solution costs.

        Returns:
            Cheapest candidate per word that strictly improves the frontier's
            previous best path.
        """
        # Collapse duplicate children before comparing them with persistent
        # discovered state; only the cheapest version of each word can win.
        cheapest_batch_nodes: dict[str, SearchNode] = {}
        for node in nodes:
            if not node.cost < cost_threshold:
                continue
            previous_batch_node = cheapest_batch_nodes.get(node.word)
            if previous_batch_node is None or node.cost < previous_batch_node.cost:
                cheapest_batch_nodes[node.word] = node

        # Persistent state changes only on strict improvement, which makes cost
        # dominance independent from heap lifetime and beam trimming.
        admitted: list[SearchNode] = []
        for node in cheapest_batch_nodes.values():
            previous = self.best_by_word.get(node.word)
            if previous is not None and node.cost >= previous.cost:
                continue
            self.best_by_word[node.word] = node

            # Replacing the best label invalidates any queued priority for the
            # prior label. The improved label is scored explicitly afterward.
            if node.word in self._open:
                del self._open[node.word]
            admitted.append(node)
        return tuple(admitted)

    async def enqueue(
        self,
        nodes: Iterable[SearchNode],
        scorer: TargetBoundScorer,
        *,
        cost_threshold: float,
        score_is_lower_bound: bool = False,
        terminal_words: frozenset[str] = frozenset(),
    ) -> None:
        """Score and queue admitted nodes eligible for expansion.

        Args:
            nodes: Nodes already accepted into discovered state.
            scorer: Prepared batch scorer used for queue priority.
            cost_threshold: Exclusive bound on useful solution costs.
            score_is_lower_bound: Whether scores can safely be checked against
                ``cost_threshold`` instead of serving as ordering only.
            terminal_words: Words recorded as results but never expanded.

        Raises:
            ValueError: The scorer returns NaN for an eligible node.
        """
        # Boundary and terminal nodes remain valid discovered results but cannot
        # lead to an eligible continuation.
        continuations = tuple(
            node
            for node in nodes
            if node.cost + MIN_EDGE_COST < cost_threshold
            and node.word not in terminal_words
        )
        if not continuations:
            return

        # Score one admitted batch. NaN has no stable ordering; infinities are
        # valid for ordering-only scorers and naturally fail a finite bound.
        scores = await scorer(continuations)
        for node in continuations:
            score = scores[node]
            if math.isnan(score):
                raise ValueError(f"Scorer returned NaN for '{node.word}'.")
            if score_is_lower_bound and not score < cost_threshold:
                continue
            self._open[node.word] = score

    def pop_batch(
        self,
        size: int | None,
        *,
        cost_threshold: float,
        score_is_lower_bound: bool = False,
    ) -> tuple[SearchNode, ...]:
        """Pop OPEN nodes that remain eligible to improve a solution.

        Args:
            size: Maximum live nodes to return, or ``None`` for the full queue.
            cost_threshold: Exclusive bound on useful solution costs.
            score_is_lower_bound: Whether ordered scores are solution lower
                bounds. If the best one fails, the whole OPEN set is pruned.

        Returns:
            Up to ``size`` current best nodes in priority order. Nodes outside
            the current threshold are omitted.
        """
        batch: list[SearchNode] = []
        size = size or len(self._open)
        while self._open and len(batch) < size:
            word, priority = self._open.popitem()

            # All remaining scores are at least this large, so a failed valid
            # lower bound exhausts the currently useful OPEN set.
            if score_is_lower_bound and not priority < cost_threshold:
                self._open = pqdict()
                break

            node = self.best_by_word[word]
            if not node.cost + MIN_EDGE_COST < cost_threshold:
                continue

            batch.append(node)

        return tuple(batch)

    def trim_queue(
        self,
        limit: int | None,
        *,
        cost_threshold: float,
        score_is_lower_bound: bool = False,
    ) -> None:
        """Retain the best eligible OPEN entries for a finite beam.

        Args:
            limit: Maximum entries to retain. ``None`` leaves an unrestricted
                OPEN set untouched.
            cost_threshold: Exclusive bound on useful solution costs.
            score_is_lower_bound: Whether scores may be pruned by the threshold.

        Discovered state is retained, so a later strict improvement to a
        trimmed word can enter the queue again.
        """
        if limit is None:
            return

        # Priority pops select the exact best eligible beam without scanning
        # entries that rank below its final member.
        retained: list[tuple[str, float]] = []
        while self._open and len(retained) < limit:
            word, priority = self._open.popitem()
            if score_is_lower_bound and not priority < cost_threshold:
                break
            node = self.best_by_word[word]
            if not node.cost + MIN_EDGE_COST < cost_threshold:
                continue
            retained.append((word, priority))

        # Beam trimming is destructive only to OPEN; discovered best labels
        # remain available for dominance and later strict-cost re-entry.
        self._open = pqdict(retained)


class CollideFrontiers(NamedTuple):
    """Start and target frontiers participating in one collide search."""

    start: Frontier
    target: Frontier

    def opposite(self, frontier: Frontier) -> Frontier:
        """Return the frontier expanding from the other collide root."""
        return self.target if frontier is self.start else self.start


class GeneralizedShortestPathSearch:
    """Finds the cheapest path between two words in a directed graph. By using a priority queue with arbitrary scoring and node reopening for cost improvements."""

    def __init__(
        self,
        scorer: Scorer,
        queue_limit: int | None = None,
        batch_size: int | None = 1,
        max_cost: float = 8.0,
    ):
        """Configure frontier ordering, retention, and solution limits.

        Args:
            scorer: Strategy used to assign expansion priorities.
            queue_limit: Maximum live entries retained per frontier, or
                ``None`` for an unrestricted queue.
            batch_size: Live nodes expanded per iteration, or ``None`` for the
                complete current queue.
            max_cost: Exclusive result-cost limit. Collide search applies it
                to each lane independently.

        Raises:
            ValueError: A queue or batch limit is non-positive, or ``max_cost``
                is non-finite or non-positive.
        """
        if queue_limit is not None and queue_limit <= 0:
            raise ValueError("queue_limit must be positive or None.")
        if batch_size is not None and batch_size <= 0:
            raise ValueError("batch_size must be positive or None.")
        if not math.isfinite(max_cost) or max_cost <= 0:
            raise ValueError("max_cost must be finite and positive.")

        self.scorer = scorer
        self.queue_limit = queue_limit
        self.batch_size = batch_size
        self.max_cost = max_cost

    @property
    def options_display(self) -> list[str]:
        """Return configured frontier and scorer options."""
        return [
            f"QueueLimit: {self.queue_limit}",
            f"BatchSize: {self.batch_size}",
            f"MaxCost: {self.max_cost:g}",
            f"Scorer: {self.scorer}",
        ]

    def __repr__(self) -> str:
        """Return the search name and configured options."""
        return f"{self.__class__.__name__} ({', '.join(self.options_display)})"

    @staticmethod
    async def _expand_batch(
        nodes: Sequence[SearchNode],
        link_reader: LinkReader,
    ) -> tuple[list[SearchNode], bool]:
        """Expand nodes until the batch or shared budget is exhausted.

        Args:
            nodes: Priority-ordered nodes to expand.
            link_reader: Budgeted reader supplying outgoing transitions.

        Returns:
            Generated child nodes and a boolean indicating if the budget is exhausted.
            Children for the queried prefix of a partial batch are retained.
        """
        words = tuple(node.word for node in nodes)
        link_batch, exhausted = await link_reader(words)

        # Re-associate each source's edges with its path node after the shared
        # query so accumulated cost, depth, and parentage remain lane-specific.
        children = [
            SearchNode(
                word=edge.target,
                cost=node.cost + edge.cost,
                depth=node.depth + 1,
                parent=node,
            )
            for node in nodes
            for edge in link_batch.get(node.word, ())
        ]
        return children, exhausted

    @staticmethod
    def _select_frontier(
        frontiers: CollideFrontiers,
        previous: Frontier,
    ) -> Frontier | None:
        """Select the next collide frontier by live minimum priority.

        Args:
            frontiers: Start and target lanes participating in the search.
            previous: Lane selected on the previous iteration.

        Returns:
            Lowest-priority nonempty frontier, alternating away from
            ``previous`` when both minima are equal, or ``None`` when exhausted.
        """
        available = [frontier for frontier in frontiers if frontier]
        if not available:
            return None

        minimum_priority = min(frontier.minimum_priority for frontier in available)
        tied = [
            frontier
            for frontier in available
            if frontier.minimum_priority == minimum_priority
        ]
        if len(tied) == 1:
            return tied[0]

        # Equal priorities alternate lanes instead of systematically favoring
        # the start frontier.
        opposite = frontiers.opposite(previous)
        return next(frontier for frontier in tied if frontier is opposite)

    @staticmethod
    def _meeting_solution(
        frontiers: CollideFrontiers,
        frontier: Frontier,
        node: SearchNode,
    ) -> NodePair | None:
        """Build a collide solution when both lanes discovered one word.

        Args:
            frontiers: Both collide lanes and their discovered state.
            frontier: Lane that admitted ``node``.
            node: Newly admitted path version.

        Returns:
            Start/target node pair for the common word, or ``None`` when the
            opposite lane has not discovered it.
        """
        opposite_node = frontiers.opposite(frontier).best_by_word.get(node.word)
        if opposite_node is None:
            return None
        if frontier is frontiers.start:
            return NodePair(node, opposite_node)
        return NodePair(opposite_node, node)

    @classmethod
    def _record_collisions(
        cls,
        frontiers: CollideFrontiers,
        frontier: Frontier,
        nodes: Iterable[SearchNode],
        best_solution: NodePair | None,
    ) -> NodePair | None:
        """Update an incumbent with collisions from newly admitted nodes.

        Args:
            frontiers: Both collide lanes and their discovered state.
            frontier: Lane that admitted ``nodes``.
            nodes: Strict path improvements to inspect for meetings.
            best_solution: Cheapest collision discovered before this batch.

        Returns:
            Cheapest prior or newly formed collision.
        """
        for node in nodes:
            solution = cls._meeting_solution(frontiers, frontier, node)
            if solution is not None and (
                best_solution is None or solution.cost < best_solution.cost
            ):
                best_solution = solution
        return best_solution

    def _collide_cost_threshold(
        self,
        best_solution: NodePair | None,
    ) -> float:
        """Return the exclusive per-lane threshold under an incumbent.

        A lane's accumulated cost lower-bounds any collision containing that
        path. Current opposite-root scores do not lower-bound the cost of a
        common descendant and therefore remain ordering-only.
        """
        if best_solution is None:
            return self.max_cost
        return min(self.max_cost, best_solution.cost)

    def _regular_cost_threshold(
        self,
        frontier: Frontier,
        target: str,
    ) -> float:
        """Return the exclusive configured or incumbent cost threshold."""

        incumbent = frontier.best_by_word.get(target)
        if incumbent is None:
            return self.max_cost
        return min(self.max_cost, incumbent.cost)

    async def _search_regular(
        self,
        start: SearchNode,
        target: str,
        link_reader: LinkReader,
        node_scorer: TargetBoundScorer,
    ) -> SearchNode | None:
        """Search one prepared frontier for a fixed target.

        Args:
            start: Root node for the regular search.
            target: Normalized terminal word.
            link_reader: Reader enforcing the expansion budget.
            node_scorer: Scorer prepared for the fixed target.

        Returns:
            Cheapest target node discovered within the retained queue, cost
            limit, and expansion budget, or ``None``.
        """
        # The target is terminal: discovery records an incumbent, but the target
        # itself never consumes another expansion.
        frontier = Frontier(start)
        score_is_lower_bound = self.scorer.is_regular_lower_bound
        terminal_words = frozenset({target})
        await frontier.enqueue(
            (start,),
            node_scorer,
            cost_threshold=self._regular_cost_threshold(frontier, target),
            score_is_lower_bound=score_is_lower_bound,
            terminal_words=terminal_words,
        )

        while frontier:
            cost_threshold = self._regular_cost_threshold(frontier, target)

            nodes = frontier.pop_batch(
                self.batch_size,
                cost_threshold=cost_threshold,
                score_is_lower_bound=score_is_lower_bound,
            )
            if not nodes:
                continue

            # Admit children completed before budget exhaustion, then stop after
            # updating discovered state and queue retention.
            children, exhausted = await self._expand_batch(nodes, link_reader)
            admitted = frontier.admit(children, cost_threshold)

            # Admission may establish a cheaper target. Apply that tightened
            # threshold before scoring or retaining any admitted continuation.
            cost_threshold = self._regular_cost_threshold(frontier, target)
            await frontier.enqueue(
                admitted,
                node_scorer,
                cost_threshold=cost_threshold,
                score_is_lower_bound=score_is_lower_bound,
                terminal_words=terminal_words,
            )
            frontier.trim_queue(
                self.queue_limit,
                cost_threshold=cost_threshold,
                score_is_lower_bound=score_is_lower_bound,
            )
            if exhausted:
                break

        return frontier.best_by_word.get(target)

    @staticmethod
    def _fixed_scorer_for_frontier(
        frontier: Frontier,
        frontiers: CollideFrontiers,
        start_scorer: TargetBoundScorer,
        target_scorer: TargetBoundScorer,
    ) -> TargetBoundScorer:
        """Select the fixed-root scorer prepared for one collide lane."""
        return start_scorer if frontier is frontiers.start else target_scorer

    async def _search_collide(
        self,
        roots: NodePair,
        link_reader: LinkReader,
        start_scorer: TargetBoundScorer,
        target_scorer: TargetBoundScorer,
    ) -> NodePair | None:
        """Search for a common descendant using fixed-root priorities.

        Args:
            roots: Zero-cost root node for each lane.
            link_reader: Expansion reader shared by both lanes.
            start_scorer: Start-lane scorer bound to the target root.
            target_scorer: Target-lane scorer bound to the start root.

        Returns:
            Cheapest collision discovered within configured limits, or
            ``None``.
        """
        # Seed both roots in persistent discovered state before either lane
        # expands, allowing every later improvement to check for a meeting.
        frontiers = CollideFrontiers(Frontier(roots.start), Frontier(roots.target))
        cost_threshold = self._collide_cost_threshold(None)
        await frontiers.start.enqueue(
            (roots.start,), start_scorer, cost_threshold=cost_threshold
        )
        await frontiers.target.enqueue(
            (roots.target,), target_scorer, cost_threshold=cost_threshold
        )

        best_solution: NodePair | None = None
        previous_frontier = frontiers.target

        while (
            frontier := self._select_frontier(frontiers, previous_frontier)
        ) is not None:
            previous_frontier = frontier
            cost_threshold = self._collide_cost_threshold(best_solution)
            nodes = frontier.pop_batch(
                self.batch_size,
                cost_threshold=cost_threshold,
            )
            if not nodes:
                continue

            # Collision checks use admitted improvements rather than transient
            # queue entries, so the lanes need not reach a word simultaneously.
            children, exhausted = await self._expand_batch(nodes, link_reader)
            scorer = self._fixed_scorer_for_frontier(
                frontier, frontiers, start_scorer, target_scorer
            )
            admitted = frontier.admit(children, cost_threshold)
            best_solution = self._record_collisions(
                frontiers, frontier, admitted, best_solution
            )
            cost_threshold = self._collide_cost_threshold(best_solution)
            await frontier.enqueue(
                admitted,
                scorer,
                cost_threshold=cost_threshold,
            )
            frontier.trim_queue(
                self.queue_limit,
                cost_threshold=cost_threshold,
            )
            if exhausted:
                break

        return best_solution

    @final
    async def search_regular(
        self,
        start: str,
        target: str,
        edge_constraints: EdgeConstraints = EdgeConstraints(),
        max_expansions: int = 1000,
    ) -> RegularSearchResult | None:
        """Search for a directed path from one word to another.

        Args:
            start: Source word. Search normalizes it to lowercase.
            target: Destination word. Search normalizes it to lowercase.
            edge_constraints: Dictionary link representation, lexical fields,
                and target POS buckets available to traversal.
            max_expansions: Maximum source words expanded by this operation.

        Returns:
            Complete start-to-target path, or ``None`` when no path is
            discovered within the configured cost, queue, and expansion limits.

        Raises:
            ValueError: ``max_expansions`` is negative.
        """
        # Validate the operation budget before the zero-link shortcut.
        validate_max_expansions(max_expansions)
        start = start.lower()
        target = target.lower()
        if start == target:
            return RegularSearchResult(start_path=(start,))

        # Prepare one session, budgeted reader, and fixed-target scorer for the
        # complete search operation.
        start_node = SearchNode(start, 0.0, 0)
        target_node = SearchNode(target, 0.0, 0)
        async with ASYNC_SESSION_MAKER() as session:
            link_reader = make_budgeted_link_reader(
                session,
                max_expansions,
                edge_constraints,
            )
            node_scorer = await self.scorer.bind_target(
                target_node, session, edge_constraints
            )
            solution = await self._search_regular(
                start_node, target, link_reader, node_scorer
            )

        return (
            RegularSearchResult(start_path=solution.path)
            if solution is not None
            else None
        )

    @final
    async def search_collide(
        self,
        start: str,
        target: str,
        edge_constraints: EdgeConstraints = EdgeConstraints(),
        max_expansions: int = 1000,
    ) -> CollideSearchResult | None:
        """Search two outgoing lanes for a shared descendant.

        Args:
            start: First root word, normalized to lowercase.
            target: Second root word, normalized to lowercase.
            edge_constraints: Dictionary link representation, lexical fields,
                and target POS buckets shared by both lanes.
            max_expansions: Maximum source words expanded across both lanes.

        Returns:
            Two root-to-meeting paths, or ``None`` when no collision is
            discovered within the configured cost, queue, and expansion limits.

        Raises:
            ValueError: ``max_expansions`` is negative.
        """
        # Validate the shared budget before the zero-link collision shortcut.
        validate_max_expansions(max_expansions)
        start = start.lower()
        target = target.lower()
        if start == target:
            return CollideSearchResult(
                start_path=(start,),
                target_path=(target,),
            )

        # Both lanes share a session and expansion reader so every expanded word
        # consumes the same operation-level budget.
        roots = NodePair(
            start=SearchNode(start, 0.0, 0),
            target=SearchNode(target, 0.0, 0),
        )
        async with ASYNC_SESSION_MAKER() as session:
            link_reader = make_budgeted_link_reader(
                session,
                max_expansions,
                edge_constraints,
            )
            start_scorer = await self.scorer.bind_target(
                roots.target, session, edge_constraints
            )
            target_scorer = await self.scorer.bind_target(
                roots.start, session, edge_constraints
            )
            solution = await self._search_collide(
                roots, link_reader, start_scorer, target_scorer
            )

        return (
            CollideSearchResult(
                start_path=solution.start.path,
                target_path=solution.target.path,
            )
            if solution is not None
            else None
        )

    @classmethod
    def beam_search(
        cls,
        scorer: Scorer,
        beam_width: int = 10,
        *,
        max_cost: float = 8.0,
    ) -> Self:
        """Create a breadth-batched beam-search configuration.

        Args:
            scorer: Strategy used to prioritize frontier nodes.
            beam_width: Maximum live entries retained per frontier.
            max_cost: Exclusive result-cost limit per regular path or collide
                lane.

        Returns:
            Search that expands each retained frontier batch before trimming it
            back to ``beam_width`` entries.
        """
        return cls(
            scorer=scorer,
            queue_limit=beam_width,
            batch_size=None,
            max_cost=max_cost,
        )

    @classmethod
    def best_first_search(
        cls,
        scorer: Scorer,
        *,
        max_cost: float = 8.0,
    ) -> Self:
        """Create an unrestricted best-first configuration.

        Args:
            scorer: Strategy used to prioritize frontier nodes.
            max_cost: Exclusive result-cost limit per regular path or collide
                lane.

        Returns:
            Search that retains the complete live queue and expands one node per
            iteration.
        """
        return cls(
            scorer=scorer,
            queue_limit=None,
            batch_size=1,
            max_cost=max_cost,
        )
