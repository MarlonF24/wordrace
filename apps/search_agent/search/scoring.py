"""Node scoring and heuristic preparation for database graph search."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable, Collection
from pathlib import Path
from typing import TYPE_CHECKING, Literal, NamedTuple, final

from jaxtyping import Float
import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import torch as t

from search_agent.db import (
    Embeddings,
    NUM_SELECTABLE_LEXICAL_KEYS,
    NUM_WINK_POS_TAGS,
    SelectableLexicalKey,
    WinkPosTag,
)
from search_agent.logger import logger
from search_agent.search.contracts import EdgeConstraints

if TYPE_CHECKING:
    from search_agent.search.deep_learn.cost_model import CostApproximation


type SimilarityFunc = Callable[
    [Float[np.ndarray, "... dims"], Float[np.ndarray, "... dims"]],
    Float[np.ndarray, "..."],
]
type NodeScores = dict[SearchNode, float]
type TargetBoundScorer = Callable[[Collection[SearchNode]], Awaitable[NodeScores]]


FILE_DIR = Path(__file__).parent
COSINE_NORM_EPSILON = 1e-12
LEARNED_COST_MODEL_PATH = FILE_DIR / "deep_learn" / "models" / "best_CostApproximation.pt"


async def get_semantic_embedding(
    session: AsyncSession,
    word: str,
) -> Float[np.ndarray, "dims"]:
    """Return the stored semantic embedding for one word.

    Args:
        session: Async SQLAlchemy session.
        word: Dictionary word whose embedding should be fetched.

    Returns:
        The word's embedding vector.
    """
    result = await session.execute(
        select(Embeddings.embedding).where(Embeddings.word == word)
    )
    return result.scalar_one()


async def get_semantic_embeddings(
    session: AsyncSession,
    words: Collection[str],
):
    """Return stored word and embedding rows for a search-node collection.

    Args:
        session: Async SQLAlchemy session.
        words: Dictionary words whose embeddings should be fetched.

    Returns:
        SQLAlchemy rows containing each found word and embedding.
    """
    result = await session.execute(
        select(Embeddings.word, Embeddings.embedding).where(Embeddings.word.in_(words))
    )
    return result.tuples().all()


async def get_graph_embeddings(
    session: AsyncSession,
    word: str,
) -> Float[np.ndarray, "dims"] | None:
    """Reserve the graph-embedding heuristic interface.

    Args:
        session: Session available to a future graph-embedding implementation.
        word: Word whose graph embedding would be fetched.

    Raises:
        NotImplementedError: Graph embeddings are not implemented.
    """
    del session, word
    raise NotImplementedError(
        "Graph-based heuristics are not implemented. A future embedder could "
        "learn graph structure rather than word semantics."
    )


_GLOBAL_MEAN_CACHE: dict[int, Float[np.ndarray, "dims"]] = {}


async def get_global_mean(
    session: AsyncSession,
    sample_limit: int = 1000,
) -> Float[np.ndarray, "dims"]:
    """Return a cached mean over a bounded sample of stored embeddings.

    Args:
        session: Async SQLAlchemy session used on the first request for a
            given sample size.
        sample_limit: Maximum number of embedding rows included in the mean.

    Returns:
        Mean embedding vector cached by ``sample_limit``.
    """
    if sample_limit not in _GLOBAL_MEAN_CACHE:
        result = await session.execute(select(Embeddings.embedding).limit(sample_limit))
        _GLOBAL_MEAN_CACHE[sample_limit] = np.mean(
            np.asarray(result.scalars().all(), dtype=np.float32),
            axis=0,
        )
    return _GLOBAL_MEAN_CACHE[sample_limit]


class SearchNode(NamedTuple):
    """Represent one discovered path version for a dictionary word.

    Attributes:
        word: Current dictionary vertex.
        cost: Accumulated transition cost from the lane root.
        depth: Number of links from the lane root.
        parent: Previous node on this immutable path, or ``None`` at the root.
    """

    word: str
    cost: float
    depth: int
    parent: SearchNode | None = None

    @property
    def path(self) -> tuple[str, ...]:
        """Return the complete root-to-node word path."""
        words: list[str] = []
        node: SearchNode | None = self
        while node is not None:
            words.append(node.word)
            node = node.parent
        return tuple(reversed(words))


class Scorer(ABC):
    """Prepare batch node scoring for one fixed target."""

    @abstractmethod
    async def bind_target(
        self,
        target: SearchNode,
        session: AsyncSession,
        edge_constraints: EdgeConstraints,
    ) -> TargetBoundScorer:
        """Prepare scoring for one fixed target.

        Args:
            target: Target node reused across scored batches.
            session: Database session available to scorer preparation.
            edge_constraints: Edge settings that may contribute scorer
                features.

        Returns:
            Batch scorer accepting only candidate nodes.
        """

    @property
    def options_display(self) -> list[str]:
        """Return short option strings used in search displays."""
        return []

    @property
    def is_regular_lower_bound(self) -> bool:
        """Return whether priorities lower-bound regular solution cost."""
        return False

    def __repr__(self) -> str:
        """Return the scorer name and its configured options."""
        options = f" ({', '.join(self.options_display)})" if self.options_display else ""
        return f"{self.__class__.__name__}{options}"


class UninformedScorer(Scorer):
    """Score nodes without inspecting the target or graph settings."""

    @abstractmethod
    def score_node(self, node: SearchNode) -> float:
        """Return the expansion priority for one node."""

    async def score_nodes(
        self,
        nodes: Collection[SearchNode],
    ) -> NodeScores:
        """Return independently calculated scores for one node batch."""
        return {node: self.score_node(node) for node in nodes}

    @final
    async def bind_target(
        self,
        target: SearchNode,
        session: AsyncSession,
        edge_constraints: EdgeConstraints,
    ) -> TargetBoundScorer:
        """Return target-independent scoring under the shared interface."""
        del target, session, edge_constraints
        return self.score_nodes


class UniformCostScorer(UninformedScorer):
    """Expand nodes in ascending accumulated-cost order."""

    def score_node(self, node: SearchNode) -> float:
        """Return the node's accumulated transition cost."""
        return node.cost

    @property
    def is_regular_lower_bound(self) -> bool:
        """Return that accumulated cost lower-bounds every completion."""
        return True


class RandomScorer(UninformedScorer):
    """Expand nodes according to independent random priorities."""

    def score_node(self, node: SearchNode) -> float:
        """Return a random priority, ignoring node content."""
        del node
        return float(np.random.rand())


class DepthBasedScorer(UninformedScorer):
    """Convert search-node path depth into an expansion priority."""

    @final
    def score_node(self, node: SearchNode) -> float:
        """Return the configured priority for the node's depth."""
        return self.score_depth(node.depth)

    @abstractmethod
    def score_depth(self, depth: int) -> float:
        """Return the priority assigned to one path depth."""


class BreadthFirstScorer(DepthBasedScorer):
    """Expand shallow nodes before deep nodes."""

    def score_depth(self, depth: int) -> float:
        """Return increasing priority as depth increases."""
        return float(depth)


class DepthFirstScorer(DepthBasedScorer):
    """Expand deep nodes before shallow nodes."""

    def score_depth(self, depth: int) -> float:
        """Return decreasing priority as depth increases."""
        return -float(depth)


class Heuristic(Scorer):
    """Estimate node desirability relative to changing or fixed targets."""

    def __init__(self, is_admissible: bool = False):
        """Configure the regular-search lower-bound declaration.

        Args:
            is_admissible: Whether every estimate is guaranteed not to exceed
                the true remaining regular-search cost.
        """
        super().__init__()
        self.is_admissible = is_admissible


def cosine_similarity(
    nodes: Float[np.ndarray, "... dims"],
    target: Float[np.ndarray, "dims"],
) -> Float[np.ndarray, "..."]:
    """Return cosine similarity between node and target embeddings."""
    dot_products = np.dot(nodes, target)
    norms = np.linalg.norm(nodes, axis=1) * np.linalg.norm(target)
    return dot_products / (norms + COSINE_NORM_EPSILON)


def negative_euclidean_distance(
    nodes: Float[np.ndarray, "... dims"],
    target: Float[np.ndarray, "dims"],
) -> Float[np.ndarray, "..."]:
    """Return negative Euclidean distance from each node to the target."""
    return -np.linalg.norm(nodes - target, axis=1)


class EmbeddingSimilarityHeuristic(Heuristic):
    """Use negated semantic similarity as a node cost."""

    def __init__(
        self,
        similarity_func: SimilarityFunc = cosine_similarity,
        use_global_mean: bool = False,
        not_found_value: float = float("inf"),
        is_admissible: bool = False,
    ):
        """Configure semantic-embedding scoring.

        Args:
            similarity_func: Vectorized similarity function whose larger raw
                values represent stronger similarity.
            use_global_mean: Whether to center embeddings around a sampled mean.
            not_found_value: Cost assigned to missing node embeddings.
            is_admissible: Whether scores lower-bound regular remaining cost.
        """
        super().__init__(is_admissible=is_admissible)
        self.similarity_func = similarity_func
        self.use_global_mean = use_global_mean
        self.not_found_value = not_found_value

    @property
    def options_display(self) -> list[str]:
        """Return similarity options used in search displays."""
        return [
            self.similarity_func.__name__,
            f"GlobalMean: {self.use_global_mean}",
        ]

    async def _prepare_embedding(
        self,
        session: AsyncSession,
        word: str,
        global_mean: Float[np.ndarray, "dims"] | None,
    ) -> Float[np.ndarray, "dims"]:
        """Fetch and optionally center one target embedding."""
        embedding = np.asarray(
            await get_semantic_embedding(session, word),
            dtype=np.float32,
        )
        return embedding - global_mean if global_mean is not None else embedding

    async def _score_nodes(
        self,
        nodes: Collection[SearchNode],
        target: SearchNode,
        target_embedding: Float[np.ndarray, "dims"],
        global_mean: Float[np.ndarray, "dims"] | None,
        session: AsyncSession,
    ) -> NodeScores:
        """Score one node batch against a prepared target embedding.

        Args:
            nodes: Discovered path versions to score.
            target: Target node whose word receives an exact zero score.
            target_embedding: Prepared target vector.
            global_mean: Optional centering vector applied to node embeddings.
            session: Database session used to fetch node embeddings.

        Returns:
            Score for every supplied node, including configured missing-value
            scores when an embedding is unavailable.
        """
        if not nodes:
            return {}

        words = {node.word for node in nodes}
        word_scores = {word: self.not_found_value for word in words}
        rows = await get_semantic_embeddings(session, words)

        if rows:
            found_words, found_embeddings = zip(*rows)
            embeddings = np.asarray(
                found_embeddings,
                dtype=np.float32,
            )
            if global_mean is not None:
                embeddings = embeddings - global_mean

            similarities = self.similarity_func(embeddings, target_embedding)
            word_scores.update(
                {
                    word: -float(similarity)
                    for word, similarity in zip(found_words, similarities)
                }
            )

        word_scores[target.word] = 0.0
        return {node: word_scores[node.word] for node in nodes}

    async def bind_target(
        self,
        target: SearchNode,
        session: AsyncSession,
        edge_constraints: EdgeConstraints,
    ) -> TargetBoundScorer:
        """Bind one target embedding for repeated node batches."""
        del edge_constraints
        global_mean = await get_global_mean(session) if self.use_global_mean else None
        target_embedding = await self._prepare_embedding(
            session,
            target.word,
            global_mean,
        )

        async def score_nodes(
            nodes: Collection[SearchNode],
        ) -> NodeScores:
            return await self._score_nodes(
                nodes,
                target,
                target_embedding,
                global_mean,
                session,
            )

        return score_nodes


class LearnedCostHeuristic(Heuristic):
    """Estimate remaining graph cost with a trained ``CostApproximation`` model."""

    _lexical_field_to_index = {
        lexical_field: index for index, lexical_field in enumerate(SelectableLexicalKey)
    }
    _pos_to_index = {pos: index for index, pos in enumerate(WinkPosTag)}

    def __init__(
        self,
        model_path: Path | str = LEARNED_COST_MODEL_PATH,
        device: Literal["cpu", "cuda"] = "cpu",
        not_found_value: float = float("inf"),
        unreachable_penalty: float = 0.0,
        is_admissible: bool = False,
    ):
        """Configure learned-cost inference.

        Args:
            model_path: Checkpoint produced by ``CostApproximation.fit``.
            device: PyTorch device used for model inference.
            not_found_value: Cost assigned to missing node embeddings.
            unreachable_penalty: Additional cost weighted by the model's
                predicted probability that a node cannot reach the target.
            is_admissible: Whether predictions lower-bound regular remaining
                cost. Learned predictions are not admissible by default.
        """
        super().__init__(is_admissible=is_admissible)
        self.model_path = Path(model_path)
        self.device = t.device(device)
        self.not_found_value = not_found_value
        self.unreachable_penalty = unreachable_penalty
        self.model: CostApproximation | None = None

    @property
    def options_display(self) -> list[str]:
        """Return checkpoint and inference options used in search displays."""
        return [
            self.model_path.name,
            f"UnreachablePenalty: {self.unreachable_penalty}",
        ]

    def _load_model(self) -> CostApproximation:
        """Load and retain the configured model checkpoint on first use."""
        if self.model is not None:
            return self.model

        # Import lazily so ordinary search imports do not initialize the
        # deep-learning package or create a package import cycle.
        from search_agent.search.deep_learn.cost_model import (
            CostApproximation,
            CostApproximationEval,
            CostApproximationLoss,
        )

        logger.info(
            "Loading learned-cost model from %s on %s.",
            self.model_path,
            self.device,
        )
        model = CostApproximation(
            loss_fn=CostApproximationLoss(),
            eval_fn=CostApproximationEval(),
        )
        model.load_state_dict(t.load(self.model_path, map_location=self.device))
        model.to(self.device)
        model.eval()
        self.model = model
        return model

    def _build_lexical_field_mask(
        self,
        available_lexical_fields: Collection[SelectableLexicalKey],
    ) -> Float[np.ndarray, f"{NUM_SELECTABLE_LEXICAL_KEYS}"]:
        """Return the dense lexical-field mask used by model features."""
        mask = np.zeros(NUM_SELECTABLE_LEXICAL_KEYS, dtype=np.float32)
        for lexical_field in available_lexical_fields:
            mask[self._lexical_field_to_index[lexical_field]] = 1.0
        return mask

    def _build_pos_mask(
        self,
        available_pos: Collection[WinkPosTag],
    ) -> Float[np.ndarray, f"{NUM_WINK_POS_TAGS}"]:
        """Return the dense Wink POS mask used by model features."""
        mask = np.zeros(NUM_WINK_POS_TAGS, dtype=np.float32)
        for pos in available_pos:
            mask[self._pos_to_index[pos]] = 1.0
        return mask

    async def _score_nodes(
        self,
        nodes: Collection[SearchNode],
        target: SearchNode,
        target_embedding: Float[np.ndarray, "dims"],
        lexical_field_mask: Float[
            np.ndarray,
            f"{NUM_SELECTABLE_LEXICAL_KEYS}",
        ],
        pos_mask: Float[np.ndarray, f"{NUM_WINK_POS_TAGS}"],
        edge_constraints: EdgeConstraints,
        session: AsyncSession,
        model: CostApproximation,
    ) -> NodeScores:
        """Run one node batch against prepared learned-model inputs.

        Args:
            nodes: Discovered path versions to score.
            target: Target node whose word receives an exact zero score.
            target_embedding: Prepared target vector.
            lexical_field_mask: Dense lexical-field feature mask.
            pos_mask: Dense target-POS feature mask.
            edge_constraints: Remaining scalar graph features.
            session: Database session used to fetch node embeddings.
            model: Loaded cost-approximation model in evaluation mode.

        Returns:
            Predicted remaining-cost score for every supplied node, including
            configured missing-value scores when an embedding is unavailable.
        """
        if not nodes:
            return {}

        words = {node.word for node in nodes}
        word_scores = {word: self.not_found_value for word in words}
        rows = await get_semantic_embeddings(session, words)

        if rows:
            # The feature builder defines the exact training/inference layout.
            from search_agent.search.deep_learn.cost_model import build_cost_features

            found_words, found_embeddings = zip(*rows)
            current_embeddings = np.asarray(
                found_embeddings,
                dtype=np.float32,
            )
            target_embeddings = np.broadcast_to(
                target_embedding,
                current_embeddings.shape,
            )
            features = build_cost_features(
                current_embedding=current_embeddings,
                target_embedding=target_embeddings,
                lemmatized=edge_constraints.lemmatized,
                lexical_field_mask=lexical_field_mask,
                pos_mask=pos_mask,
            ).to(self.device)

            with t.no_grad():
                prediction = model(features)
                scores = prediction.cost.clamp_min(0.0)
                if self.unreachable_penalty:
                    # Positive reachability logits mean reachable.
                    unreachable_probability = t.sigmoid(-prediction.reachable_logit)
                    scores += self.unreachable_penalty * unreachable_probability

            word_scores.update(
                {
                    word: float(score)
                    for word, score in zip(
                        found_words,
                        scores.detach().cpu(),
                    )
                }
            )

        word_scores[target.word] = 0.0
        return {node: word_scores[node.word] for node in nodes}

    async def bind_target(
        self,
        target: SearchNode,
        session: AsyncSession,
        edge_constraints: EdgeConstraints,
    ) -> TargetBoundScorer:
        """Bind model settings and one target embedding for repeated batches."""
        model = self._load_model()
        lexical_field_mask = self._build_lexical_field_mask(
            edge_constraints.available_lexical_fields
        )
        pos_mask = self._build_pos_mask(edge_constraints.available_pos)
        target_embedding = np.asarray(
            await get_semantic_embedding(session, target.word),
            dtype=np.float32,
        )

        async def score_nodes(
            nodes: Collection[SearchNode],
        ) -> NodeScores:
            return await self._score_nodes(
                nodes,
                target,
                target_embedding,
                lexical_field_mask,
                pos_mask,
                edge_constraints,
                session,
                model,
            )

        return score_nodes


class InformedScorer(Scorer):
    """Transform heuristic estimates into complete node priorities."""

    def __init__(self, heuristic: Heuristic):
        """Configure informed scoring with one heuristic provider."""
        self.heuristic = heuristic

    @abstractmethod
    def combine_score(
        self,
        node: SearchNode,
        target: SearchNode,
        heuristic_score: float,
    ) -> float:
        """Combine one node, target, and heuristic estimate."""

    def _combine_scores(
        self,
        nodes: Collection[SearchNode],
        target: SearchNode,
        heuristic_scores: NodeScores,
    ) -> NodeScores:
        """Apply the concrete priority formula to a scored batch."""
        return {
            node: self.combine_score(
                node,
                target,
                heuristic_scores[node],
            )
            for node in nodes
        }

    async def bind_target(
        self,
        target: SearchNode,
        session: AsyncSession,
        edge_constraints: EdgeConstraints,
    ) -> TargetBoundScorer:
        """Bind heuristic settings and one fixed scoring target."""
        heuristic_scorer = await self.heuristic.bind_target(
            target,
            session,
            edge_constraints,
        )

        async def score_nodes(
            nodes: Collection[SearchNode],
        ) -> NodeScores:
            heuristic_scores = await heuristic_scorer(nodes)
            return self._combine_scores(
                nodes,
                target,
                heuristic_scores,
            )

        return score_nodes

    @property
    def options_display(self) -> list[str]:
        """Return the configured heuristic for search displays."""
        return [f"Heuristic: {self.heuristic}"]


class GreedyScorer(InformedScorer):
    """Prioritize nodes using only their heuristic estimate."""

    def combine_score(
        self,
        node: SearchNode,
        target: SearchNode,
        heuristic_score: float,
    ) -> float:
        """Return the heuristic estimate unchanged."""
        del node, target
        return heuristic_score


class AStarScorer(InformedScorer):
    """Combine both lane costs with a weighted heuristic estimate."""

    def __init__(
        self,
        heuristic: Heuristic,
        heuristic_weight: float = 1.0,
    ):
        """Configure A-star scoring.

        Args:
            heuristic: Remaining-cost estimate used for node ordering.
            heuristic_weight: Multiplier applied to the heuristic component.
        """
        if heuristic_weight < 0:
            raise ValueError("heuristic_weight must be non-negative.")
        super().__init__(heuristic)
        self.heuristic_weight = heuristic_weight

    def combine_score(
        self,
        node: SearchNode,
        target: SearchNode,
        heuristic_score: float,
    ) -> float:
        """Return both accumulated lane costs plus weighted heuristic cost."""
        return node.cost + target.cost + self.heuristic_weight * heuristic_score

    @property
    def is_regular_lower_bound(self) -> bool:
        """Return whether priorities lower-bound regular solution cost."""
        return self.heuristic.is_admissible and self.heuristic_weight <= 1.0

    @property
    def options_display(self) -> list[str]:
        """Return heuristic and weight options for search displays."""
        return [
            *super().options_display,
            f"HeuristicWeight: {self.heuristic_weight}",
            f"RegularLowerBound: {self.is_regular_lower_bound}",
        ]
