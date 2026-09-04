"""Cost-approximation dataset, loss, metrics, and model definitions."""

import math
from dataclasses import dataclass
from itertools import chain
from pathlib import Path
from typing import Callable, NamedTuple, Self, Literal

import numpy as np
import torch as t
import torch.nn as nn
from jaxtyping import Float
from tqdm.auto import tqdm

from search_agent.db import (
    EMBEDDING_DIMENSION,
    NUM_SELECTABLE_LEXICAL_KEYS,
    NUM_WINK_POS_TAGS,
)
from search_agent.search.deep_learn.dataset import (
    PAIR_INTERACTION_FEATURE_COUNT,
    REACHABLE_COST_LABEL_MIN,
    UNREACHABLE_COST_LABEL,
    CostSearchSettings,
    EmbeddingCache,
    GeneratedIterTensorDataset,
    MapTensorDataset,
    write_pair_interactions,
)
from search_agent.search.deep_learn.model import EvaluationMetrics, MyModel
from search_agent.search.contracts import EdgeConstraints
from search_agent.search.igraph import IgraphSearch


COST_FEATURE_COUNT = (
    2 * EMBEDDING_DIMENSION
    + PAIR_INTERACTION_FEATURE_COUNT
    + NUM_SELECTABLE_LEXICAL_KEYS
    + NUM_WINK_POS_TAGS
    + 1
)

type SamplingStrategy = Literal["random", "neighbors"]

type CostFeatureBatch = Float[t.Tensor, f"batch_size {COST_FEATURE_COUNT}"]
type CostLabelBatch = Float[t.Tensor, "batch_size"]


class CostPrediction(NamedTuple):
    """Per-row outputs for the two cost-approximation tasks.

    ``cost`` is trained only on reachable rows. ``reachable_logit`` is the raw
    pre-sigmoid score for the positive class, where positive means reachable.
    The model intentionally does not apply sigmoid internally because training
    uses ``binary_cross_entropy_with_logits``, which combines sigmoid and BCE
    in one numerically stable operation. Inference code should apply sigmoid
    only when it needs a probability rather than a thresholded logit.
    """

    cost: CostLabelBatch
    reachable_logit: CostLabelBatch


@dataclass(slots=True)
class CostEvaluation(EvaluationMetrics):
    """Validation metrics for the cost and reachability heads.

    ``reachable_cost_mae`` is the mean absolute cost residual on reachable
    rows only. ``reachable_cost_residual_std`` is the standard deviation of the
    signed reachable-row residual ``predicted_cost - true_cost``.
    ``reachability_precision`` is true positives divided by rows predicted
    reachable. ``reachability_recall`` is true positives divided by reachable
    rows. ``reachability_specificity`` is true negatives divided by unreachable
    rows. Accuracy and F1 are intentionally omitted because accuracy is weak
    under class imbalance and F1 is derived from precision and recall.
    ``MyModel.evaluate`` reports the mean of these batch-level values.
    """

    reachable_cost_mae: float
    reachable_cost_residual_std: float
    reachable_cost_r2: float
    reachability_precision: float
    reachability_recall: float
    reachability_specificity: float

    @property
    def eval_score(self) -> float:
        """Primary checkpoint metric: reachable-row cost error in cost units."""
        return self.reachable_cost_mae


type CostLossFn = Callable[[CostPrediction, CostLabelBatch], t.Tensor]
type CostEvalFn = Callable[[CostPrediction, CostLabelBatch], CostEvaluation]


class IterCostDataset(GeneratedIterTensorDataset[CostFeatureBatch, CostLabelBatch]):
    """Generate source-target rows and label them with graph shortest-path cost.

    ``source_sampling`` controls the distribution of current words. Random
    sampling keeps the original uniform source-target task. Out-neighbor
    sampling draws current words from legal graph moves when possible, which
    better matches the candidates the heuristic will score during search while
    preserving the same cost-approximation labels and model interface.
    """

    class EmbeddingBatch(NamedTuple):
        """Source and target embeddings used to build one distance matrix."""

        start_words: tuple[str, ...]
        start_embeddings: Float[np.ndarray, f"source_batch_size {EMBEDDING_DIMENSION}"]
        target_words: tuple[str, ...]
        target_embeddings: Float[np.ndarray, f"target_batch_size {EMBEDDING_DIMENSION}"]

    def __init__(
        self,
        rng_seed: int | None = None,
        source_batch_size: int = 4,
        target_batch_size: int = 4096,
        batches_per_shuffle: int | None = None,
        batches_in_embedding_cache: int = 64,
        lexical_field_prob_yes: float = 0.8,
        pos_prob_yes: float = 0.8,
        source_sampling: SamplingStrategy = "random",
    ):
        """Configure generated source-target distance matrices.

        Args:
            rng_seed: Optional base seed for reproducible worker-local sampling.
            source_batch_size: Number of start words in each distance matrix.
            target_batch_size: Number of target words in each distance matrix.
            batches_per_shuffle: Optional number of generated matrices to
                concatenate and row-shuffle before yielding.
            batches_in_embedding_cache: Number of generated matrices whose
                embedding rows should fit in the per-worker cache.
            lexical_field_prob_yes: Probability that each lexical field is
                enabled for a generated search configuration.
            pos_prob_yes: Probability that each Wink POS tag is enabled for a
                generated search configuration.
            source_sampling: Source-word sampling strategy. ``"random"``
                samples uniformly from the embedding cache. ``"neighbors"``
                samples legal outgoing graph neighbors when cached embeddings
                are available, falling back to random words otherwise.
        """
        assert source_batch_size > 0, (
            f"source_batch_size must be positive, got {source_batch_size}."
        )
        assert target_batch_size > 0, (
            f"target_batch_size must be positive, got {target_batch_size}."
        )
        assert source_sampling in ("random", "neighbors"), (
            f"source_sampling must be one of ('random', 'neighbors'), got {source_sampling}."
        )

        super().__init__(
            rng_seed=rng_seed,
            batches_per_shuffle=batches_per_shuffle,
            batches_in_embedding_cache=batches_in_embedding_cache,
            lexical_field_prob_yes=lexical_field_prob_yes,
            pos_prob_yes=pos_prob_yes,
        )
        self.source_batch_size = source_batch_size
        self.target_batch_size = target_batch_size
        self.source_sampling = source_sampling

    @property
    def embedding_rows_per_batch(self) -> int:
        """Return cached embedding rows needed for one source-target matrix."""
        return self.source_batch_size + self.target_batch_size

    @staticmethod
    def build_cost_features(
        current_embedding: Float[np.ndarray, f"batch_size {EMBEDDING_DIMENSION}"],
        target_embedding: Float[np.ndarray, f"batch_size {EMBEDDING_DIMENSION}"],
        lemmatized: bool,
        lexical_field_mask: Float[np.ndarray, f"{NUM_SELECTABLE_LEXICAL_KEYS}"],
        pos_mask: Float[np.ndarray, f"{NUM_WINK_POS_TAGS}"],
    ) -> Float[t.Tensor, "batch_size n_features"]:
        """Build one feature row per current-target pair.

        The row contains both endpoint embeddings, pair geometry, and the graph
        settings used by the search that produced the label. Constraint masks
        follow the enum declaration order shared with inference.
        """
        current = np.asarray(current_embedding, dtype=np.float32)
        target = np.asarray(target_embedding, dtype=np.float32)
        features = np.empty((current.shape[0], COST_FEATURE_COUNT), dtype=np.float32)
        offset = 0

        # Keep raw endpoints first so the network can learn absolute-position effects.
        features[:, offset : offset + EMBEDDING_DIMENSION] = current
        offset += EMBEDDING_DIMENSION
        features[:, offset : offset + EMBEDDING_DIMENSION] = target
        offset += EMBEDDING_DIMENSION
        # Add pairwise geometry and the graph settings used to create the label.
        offset = write_pair_interactions(features, offset, current, target)
        features[:, offset] = float(lemmatized)
        offset += 1
        features[:, offset : offset + NUM_SELECTABLE_LEXICAL_KEYS] = lexical_field_mask
        offset += NUM_SELECTABLE_LEXICAL_KEYS
        features[:, offset:] = pos_mask
        return t.from_numpy(features)

    def sample_embeddings(
        self,
        embedding_cache: EmbeddingCache,
        search: IgraphSearch,
        rng: np.random.Generator,
        search_settings: CostSearchSettings,
    ) -> EmbeddingBatch:
        """Sample source and target rows using the configured source strategy."""
        if self.source_sampling == "neighbors":
            return self.sample_out_neighbor_embeddings(
                embedding_cache, search, rng, search_settings
            )
        return self.sample_random_embeddings(embedding_cache, rng)

    def sample_random_embeddings(
        self, embedding_cache: EmbeddingCache, rng: np.random.Generator
    ) -> EmbeddingBatch:
        """Sample disjoint source and target rows for one distance matrix.

        Args:
            embedding_cache: Worker-local pool of words and embeddings.
            rng: Worker-local random generator.

        Returns:
            Start and target words plus aligned embeddings.
        """
        sample_count = self.source_batch_size + self.target_batch_size
        # Sampling without replacement prevents a row from being both source
        # and target inside the same distance matrix.
        indices = rng.choice(len(embedding_cache.words), size=sample_count, replace=False)
        words = tuple(embedding_cache.words[index] for index in indices)
        embeddings = embedding_cache.embeddings[indices]
        return self.EmbeddingBatch(
            start_words=words[: self.source_batch_size],
            start_embeddings=embeddings[: self.source_batch_size],
            target_words=words[self.source_batch_size :],
            target_embeddings=embeddings[self.source_batch_size :],
        )

    def sample_out_neighbor_embeddings(
        self,
        embedding_cache: EmbeddingCache,
        search: IgraphSearch,
        rng: np.random.Generator,
        search_settings: CostSearchSettings,
    ) -> EmbeddingBatch:
        """Sample starts from legal outgoing neighbors when possible.

        Anchor words and targets are sampled from the embedding cache. Each
        anchor contributes one cached outgoing neighbor as the actual start
        word. Anchors without cached outgoing neighbors fall back to themselves,
        keeping batch shape fixed without adding graph-specific labels.
        """
        sample_count = self.source_batch_size + self.target_batch_size
        indices = rng.choice(len(embedding_cache.words), size=sample_count, replace=False)
        fallback_start_words = tuple(
            embedding_cache.words[index] for index in indices[: self.source_batch_size]
        )
        target_words = tuple(
            embedding_cache.words[index] for index in indices[self.source_batch_size :]
        )
        embedding_by_word = dict(
            zip(embedding_cache.words, embedding_cache.embeddings, strict=True)
        )
        cached_words = set(embedding_cache.words)
        edge_constraints = EdgeConstraints(
            lemmatized=search_settings.lemmatized,
            available_lexical_fields=frozenset(search_settings.lexical_fields),
            available_pos=frozenset(search_settings.available_pos),
        )

        # Keep the cost labels source-target only: the sampled anchor is used
        # solely to draw starts from the same distribution as legal search moves.
        start_words = tuple(
            self.sample_out_neighbor_word(
                fallback_word=fallback_word,
                cached_words=cached_words,
                search=search,
                edge_constraints=edge_constraints,
                rng=rng,
            )
            for fallback_word in fallback_start_words
        )

        return self.EmbeddingBatch(
            start_words=start_words,
            start_embeddings=np.asarray(
                [embedding_by_word[word] for word in start_words], dtype=np.float32
            ),
            target_words=target_words,
            target_embeddings=np.asarray(
                [embedding_by_word[word] for word in target_words], dtype=np.float32
            ),
        )

    def sample_out_neighbor_word(
        self,
        fallback_word: str,
        cached_words: set[str],
        search: IgraphSearch,
        edge_constraints: EdgeConstraints,
        rng: np.random.Generator,
    ) -> str:
        """Return one cached outgoing neighbor, or ``fallback_word`` if none exists."""
        neighbor_words = tuple(
            neighbor
            for neighbor in search.out_neighbors(fallback_word, edge_constraints)
            if neighbor in cached_words
        )
        if not neighbor_words:
            return fallback_word
        return neighbor_words[rng.integers(len(neighbor_words))]

    def generate_batch(
        self,
        embedding_cache: EmbeddingCache,
        search: IgraphSearch,
        rng: np.random.Generator,
        search_settings: CostSearchSettings,
    ) -> tuple[CostFeatureBatch, CostLabelBatch]:
        """Generate one fixed-settings source-target matrix and flatten it.

        Args:
            embedding_cache: Worker-local embedding pool.
            search: Reused shortest-path search object.
            rng: Worker-local random generator.
            search_settings: Graph options used to label and featurize rows.

        Returns:
            Feature rows and labels. Infinite graph distances are replaced with
            ``UNREACHABLE_COST_LABEL``.
        """
        embedding_batch = self.sample_embeddings(
            embedding_cache, search, rng, search_settings
        )

        # One search call labels the full source-target matrix under fixed settings.
        distances: Float[np.ndarray, "source_batch_size target_batch_size"] = (
            search.distance_matrix(
                start_words=embedding_batch.start_words,
                target_words=embedding_batch.target_words,
                edge_constraints=EdgeConstraints(
                    lemmatized=search_settings.lemmatized,
                    available_lexical_fields=frozenset(search_settings.lexical_fields),
                    available_pos=frozenset(search_settings.available_pos),
                ),
            )
        )
        # Expand the distance matrix axes into one row per source-target pair.
        current_embedding: Float[np.ndarray, f"batch_size {EMBEDDING_DIMENSION}"] = (
            np.repeat(
                embedding_batch.start_embeddings,
                embedding_batch.target_embeddings.shape[0],
                axis=0,
            )
        )
        target_embedding: Float[np.ndarray, f"batch_size {EMBEDDING_DIMENSION}"] = (
            np.tile(
                embedding_batch.target_embeddings,
                (embedding_batch.start_embeddings.shape[0], 1),
            )
        )
        features = self.build_cost_features(
            current_embedding=current_embedding,
            target_embedding=target_embedding,
            lemmatized=search_settings.lemmatized,
            lexical_field_mask=search_settings.lexical_field_mask,
            pos_mask=search_settings.pos_mask,
        )
        labels: Float[np.ndarray, "batch_size"] = distances.ravel()
        # Infinite graph distances become the finite sentinel used by the loss.
        labels[~np.isfinite(labels)] = UNREACHABLE_COST_LABEL
        return features, t.from_numpy(labels)


class MapCostDataset(MapTensorDataset[CostFeatureBatch, CostLabelBatch]):
    """Persisted CostApproximation rows with an unreachable sentinel label."""

    KIND = "cost_approximation"
    SENTINEL_LABEL = UNREACHABLE_COST_LABEL

    @classmethod
    def validate_feature_count(cls, feature_count: int) -> None:
        """Reject datasets that do not match the current cost feature layout."""
        assert feature_count == COST_FEATURE_COUNT, (
            f"{cls.KIND} requires {COST_FEATURE_COUNT} features, got {feature_count}."
        )

    @staticmethod
    def _is_reachable_label(labels: CostLabelBatch) -> t.Tensor:
        """Return the reachability class encoded by cost labels."""
        return labels >= REACHABLE_COST_LABEL_MIN

    @staticmethod
    def _copy_selected_rows(
        output_features: t.Tensor,
        output_labels: t.Tensor,
        output_order: t.Tensor,
        output_offset: int,
        features: CostFeatureBatch,
        labels: CostLabelBatch,
        indices: t.Tensor,
    ) -> int:
        """Copy selected rows into randomized output positions and return the count."""
        selected_count = indices.numel()
        if selected_count == 0:
            return selected_count

        output_indices = output_order[output_offset : output_offset + selected_count]
        output_features[output_indices] = features.index_select(0, indices)
        output_labels[output_indices] = labels.index_select(0, indices)
        return selected_count

    @classmethod
    def generate_from_iterable_with_reachable_share(
        cls,
        iterable_dataset: GeneratedIterTensorDataset[CostFeatureBatch, CostLabelBatch],
        n_examples: int,
        reachable_share: float,
        path: Path | None = None,
        rng_seed: int | None = None,
        description: str = "Generate cost dataset",
    ) -> Self:
        """Collect a finite dataset with the nearest achievable reachable share.

        Args:
            iterable_dataset: produces batches of features and labels to sample from.
            n_examples: total number of rows to collect, including both classes.
            reachable_share: fraction of rows with reachable labels, rounded to
                the nearest whole example. Must be in [0, 1].
            path: Optional path used to save the collected dataset.
            rng_seed: Optional seed for the final row shuffle.
            description: Progress-bar label.

        Returns:
            Finite dataset with the requested total size and class balance.
        """
        assert n_examples > 0, f"n_examples must be positive, got {n_examples}."
        assert 0 <= reachable_share <= 1, (
            f"reachable_share must be in [0, 1], got {reachable_share}."
        )

        reachable_target_count = math.floor(n_examples * reachable_share)
        unreachable_target_count = n_examples - reachable_target_count
        reachable_count = 0
        unreachable_count = 0
        shuffle_generator = (
            t.Generator().manual_seed(rng_seed) if rng_seed is not None else None
        )
        output_order = t.randperm(n_examples, generator=shuffle_generator)

        # The generated source is infinite, so its first batch defines the
        # concrete tensor dtype, device, and feature width for one allocation.
        generated_batches = iter(iterable_dataset)
        first_features, first_labels = next(generated_batches)
        output_features = t.empty(
            (n_examples, first_features.shape[1]),
            dtype=first_features.dtype,
            device=first_features.device,
        )
        output_labels = t.empty(
            n_examples,
            dtype=first_labels.dtype,
            device=first_labels.device,
        )

        progress = tqdm(total=n_examples, desc=description, dynamic_ncols=True)
        for features, labels in chain(
            ((first_features, first_labels),),
            generated_batches,
        ):
            # Filter generated rows into class-specific quotas. This keeps the
            # finite map dataset's class balance independent of graph topology.
            reachable_mask = cls._is_reachable_label(labels)
            (reachable_indices,) = t.nonzero(reachable_mask, as_tuple=True)
            (unreachable_indices,) = t.nonzero(~reachable_mask, as_tuple=True)

            reachable_keep_count = reachable_target_count - reachable_count
            selected_reachable = reachable_indices[:reachable_keep_count]
            added_reachable = cls._copy_selected_rows(
                output_features,
                output_labels,
                output_order,
                reachable_count + unreachable_count,
                features,
                labels,
                selected_reachable,
            )
            reachable_count += added_reachable

            unreachable_keep_count = unreachable_target_count - unreachable_count
            selected_unreachable = unreachable_indices[:unreachable_keep_count]
            added_unreachable = cls._copy_selected_rows(
                output_features,
                output_labels,
                output_order,
                reachable_count + unreachable_count,
                features,
                labels,
                selected_unreachable,
            )
            unreachable_count += added_unreachable

            progress.update(added_reachable + added_unreachable)
            if progress.n == n_examples:
                break

        progress.close()
        dataset = cls(output_features, output_labels)

        if path is not None:
            dataset.save(path)
        return dataset

    @classmethod
    def generate(
        cls,
        n_examples: int,
        path: Path | None = None,
        rng_seed: int | None = None,
        source_batch_size: int = 4,
        target_batch_size: int = 4096,
        batches_in_embedding_cache: int = 16,
        lexical_field_prob_yes: float = 0.8,
        pos_prob_yes: float = 0.8,
        reachable_share: float | None = None,
        source_sampling: SamplingStrategy = "random",
    ) -> Self:
        """Generate and optionally save a finite cost-approximation dataset.

        ``reachable_share`` fixes the fraction of rows whose label is a finite
        graph distance, rounded to the nearest whole example. ``None`` keeps the
        natural share produced by sampling. ``source_sampling`` controls whether
        current words are uniform random cache entries or cached outgoing graph
        neighbors.
        """
        iterable_dataset = IterCostDataset(
            rng_seed=rng_seed,
            source_batch_size=source_batch_size,
            target_batch_size=target_batch_size,
            batches_per_shuffle=None,
            batches_in_embedding_cache=batches_in_embedding_cache,
            lexical_field_prob_yes=lexical_field_prob_yes,
            pos_prob_yes=pos_prob_yes,
            source_sampling=source_sampling,
        )
        if reachable_share is not None:
            return cls.generate_from_iterable_with_reachable_share(
                iterable_dataset,
                n_examples=n_examples,
                reachable_share=reachable_share,
                path=path,
                rng_seed=rng_seed,
                description="Generate cost dataset",
            )

        return cls.generate_from_iterable(
            iterable_dataset,
            n_examples=n_examples,
            path=path,
            description="Generate cost dataset",
        )


class CostApproximationLoss(nn.Module):
    """Combine reachable-cost regression with reachability classification.

    ``reachability_weight`` multiplies the BCE term before it is added to the
    cost term. ``balance_reachability`` recomputes BCE ``pos_weight`` per batch
    as unreachable/reachable, which compensates when reachable rows are the
    minority class. Reachability predictions are raw logits, not probabilities;
    this keeps the sigmoid inside ``binary_cross_entropy_with_logits`` for
    stable training.
    """

    def __init__(
        self, reachability_weight: float = 0.5, balance_reachability: bool = True
    ):
        """Configure the two-task loss.

        Args:
            reachability_weight: Multiplier applied to the BCE reachability
                loss before adding it to reachable-row cost regression.
            balance_reachability: Whether to derive BCE positive-class weight
                from the current batch's reachable/unreachable counts.
        """
        super().__init__()
        # This controls the tradeoff between accurate costs and detecting
        # whether a finite path exists at all.
        self.reachability_weight = reachability_weight
        # When enabled, reachable mistakes receive more BCE weight in batches
        # dominated by unreachable pairs.
        self.balance_reachability = balance_reachability
        # SmoothL1 keeps the cost head robust to rare long-path outliers.
        self.cost_loss_fn = nn.SmoothL1Loss(reduction="none")

    def forward(self, prediction: CostPrediction, labels: CostLabelBatch) -> t.Tensor:
        """Return the scalar training loss for one cost batch.

        Args:
            prediction: Model outputs for cost and reachability.
            labels: Non-negative path costs for reachable pairs and
                ``UNREACHABLE_COST_LABEL`` for unreachable pairs.

        Returns:
            Weighted sum of reachable-only SmoothL1 cost loss and BCE
            reachability loss.
        """
        # Split labels into the two supervised tasks. Non-negative labels are
        # real path costs; the negative sentinel means unreachable.
        reachable = labels >= REACHABLE_COST_LABEL_MIN

        # Average the cost loss over reachable rows only. Clamping handles the
        # rare all-unreachable batch by making the masked numerator divide by 1.
        reachable_count = reachable.sum().clamp_min(1)

        # Compute cost error before masking so tensor shapes stay unchanged.
        # Sentinel rows are then zeroed because -1 is a class marker, not cost.
        cost_error = self.cost_loss_fn(prediction.cost, labels)
        cost_loss = cost_error.masked_fill(~reachable, 0.0).sum() / reachable_count

        # BCEWithLogitsLoss consumes raw logits and internally applies the
        # stable sigmoid+BCE formula.
        reachability_target = reachable.to(dtype=prediction.reachable_logit.dtype)
        reachable_examples = reachable.sum().to(dtype=prediction.reachable_logit.dtype)
        unreachable_examples = (
            (~reachable).sum().to(dtype=prediction.reachable_logit.dtype)
        )

        # pos_weight scales positive-class BCE terms. With labels
        # positive=reachable, unreachable/reachable gives each class similar
        # total influence when unreachable rows are more common.
        pos_weight = (
            (unreachable_examples / reachable_examples.clamp_min(1)).clamp_min(1.0)
            if self.balance_reachability
            else None
        )
        reachability_loss = nn.functional.binary_cross_entropy_with_logits(
            prediction.reachable_logit,
            reachability_target,
            pos_weight=pos_weight,
        )

        # Ordinary backprop still sees one scalar loss and routes gradients to
        # the shared trunk plus the two task-specific heads.
        return cost_loss + self.reachability_weight * reachability_loss


class CostApproximationEval(nn.Module):
    """Compute validation metrics for the trained tasks.

    Reachability is evaluated directly in logit space. A threshold of ``0.0``
    is equivalent to ``sigmoid(logit) >= 0.5`` without doing the sigmoid work.
    Cost metrics ignore unreachable sentinel rows because those rows have no
    finite shortest-path target for the regression head.
    """

    def __init__(self, reachability_threshold: float = 0.0):
        """Configure the reachability threshold used for validation metrics.

        Args:
            reachability_threshold: Logit cutoff used to convert reachability
                scores into predicted classes.
        """
        super().__init__()
        # Logit threshold used to convert reachability scores into a class.
        self.reachability_threshold = reachability_threshold

    def forward(
        self, prediction: CostPrediction, labels: CostLabelBatch
    ) -> CostEvaluation:
        """Compute non-redundant cost and reachability metrics for one batch.

        Args:
            prediction: Model outputs for cost and reachability.
            labels: Non-negative path costs or the unreachable sentinel.

        Returns:
            Batch-level cost MAE and binary reachability metrics.
        """
        # Use the same target split as training so validation measures the
        # learned tasks rather than a different post-processing rule.
        reachable = labels >= REACHABLE_COST_LABEL_MIN
        metric_dtype = prediction.reachable_logit.dtype

        # Cost residuals ignore sentinel rows for the same reason as the loss:
        # unreachable pairs have no numeric shortest-path cost.
        reachable_count = reachable.sum().clamp_min(1)
        cost_residual = prediction.cost.sub(labels).masked_fill(~reachable, 0.0)
        reachable_cost_mae = cost_residual.abs().sum() / reachable_count
        reachable_cost_bias = cost_residual.sum() / reachable_count
        reachable_cost_residual_variance = (
            cost_residual.square().sum() / reachable_count - reachable_cost_bias.square()
        ).clamp_min(0.0)
        reachable_cost_residual_std = reachable_cost_residual_variance.sqrt()

        # The default logit threshold 0 is equivalent to sigmoid(logit) >= 0.5.
        predicted_reachable = prediction.reachable_logit >= self.reachability_threshold

        # reachability_recall asks "of reachable rows, how many were found?", and
        # reachability_specificity asks "of unreachable rows, how many were rejected?".
        reachable_labels = labels.masked_select(reachable)
        reachable_mean = reachable_labels.mean()
        ss_tot = reachable_labels.sub(reachable_mean).square().sum().clamp_min(1e-6)
        ss_res = cost_residual.square().sum()
        reachable_cost_r2 = 1.0 - ss_res / ss_tot

        true_positive = (
            predicted_reachable.logical_and(reachable).sum().to(dtype=metric_dtype)
        )
        predicted_count = predicted_reachable.sum().clamp_min(1).to(dtype=metric_dtype)
        true_negative = (
            (~predicted_reachable).logical_and(~reachable).sum().to(dtype=metric_dtype)
        )
        unreachable_count = (~reachable).sum().clamp_min(1).to(dtype=metric_dtype)
        reach_precision = true_positive / predicted_count
        reach_recall = true_positive / reachable_count
        reach_specificity = true_negative / unreachable_count

        return CostEvaluation(
            reachable_cost_mae=float(reachable_cost_mae.detach()),
            reachable_cost_residual_std=float(reachable_cost_residual_std.detach()),
            reachable_cost_r2=float(reachable_cost_r2.detach()),
            reachability_precision=float(reach_precision.detach()),
            reachability_recall=float(reach_recall.detach()),
            reachability_specificity=float(reach_specificity.detach()),
        )


# NOTE: maybe have to look into making the loss function penalize
# cost-overestimation more than underestimation, to make the heuristic more optimistic.
class CostApproximation(
    MyModel[CostFeatureBatch, CostLabelBatch, CostPrediction, CostEvaluation]
):
    """Two-head model for current-target reachability and reachable cost.

    The reachability head returns raw logits. Keeping sigmoid out of
    ``forward`` lets training use ``binary_cross_entropy_with_logits`` and lets
    evaluation compare logits directly against an equivalent threshold.
    The shared trunk is intentionally shorter than the task heads, so cost and
    reachability can specialize after a compact common representation.
    """

    SHARED_WIDTH_FLOOR = 256
    HEAD_WIDTH_FLOOR = 64  # Minimum width of the first hidden layer in each task head.
    WIDTH_SHRINK_FACTOR = (
        2  # Factor by which each hidden layer is narrower than the previous one.
    )
    OUTPUT_WIDTH = 1

    def __init__(self, loss_fn: CostLossFn, eval_fn: CostEvalFn):
        """Build the shared trunk and two task-specific heads.

        Args:
            loss_fn: Callable used by ``fit_batch`` to train predictions.
            eval_fn: Callable used by ``evaluate`` to produce typed metrics.
        """
        super().__init__(loss_fn=loss_fn, eval_fn=eval_fn)
        shared_widths = self._halving_widths(COST_FEATURE_COUNT, self.SHARED_WIDTH_FLOOR)
        shared_output_width = shared_widths[-1]
        head_widths = self._halving_widths(shared_output_width, self.HEAD_WIDTH_FLOOR)

        self.model = self._mlp(COST_FEATURE_COUNT, shared_widths)
        self.cost_head = self._mlp(
            shared_output_width, [*head_widths[1:], self.OUTPUT_WIDTH]
        )
        self.reachable_head = self._mlp(
            shared_output_width, [*head_widths[1:], self.OUTPUT_WIDTH]
        )

    @classmethod
    def _halving_widths(cls, input_width: int, floor: int) -> list[int]:
        """Return monotonically shrinking hidden widths down to ``floor``."""
        widths = [input_width]
        while widths[-1] > floor:
            widths.append(widths[-1] // cls.WIDTH_SHRINK_FACTOR)
        return widths

    @staticmethod
    def _mlp(input_width: int, output_widths: list[int]) -> nn.Sequential:
        """Build a ReLU MLP ending at the last requested width."""
        layers: list[nn.Module] = []
        for width in output_widths:
            layers.append(nn.Linear(input_width, width))
            if width != output_widths[-1]:
                layers.append(nn.ReLU())
            input_width = width
        return nn.Sequential(*layers)

    def forward(self, input: t.Tensor) -> CostPrediction:
        """Return one cost estimate and one raw reachability logit per row."""
        features = self.model(input)
        return CostPrediction(
            cost=self.cost_head(features).squeeze(-1),
            reachable_logit=self.reachable_head(features).squeeze(-1),
        )


if __name__ == "__main__":
    for i in range(4):
        print(f"Generating cost dataset with source_sampling='random', run {i + 1}/4...")
        MapCostDataset.generate(
            n_examples=500_000,
            path=Path(__file__).parent
            / "data"
            / f"cost_approx_random_sampling_dataset_{i + 1}.pt",
            rng_seed=42 + i,
            source_batch_size=32,
            reachable_share=0.6,
            source_sampling="random",
        )
