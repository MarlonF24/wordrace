"""Inference-safe cost-model architecture, features, loss, and metrics."""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

import numpy as np
import torch as t
import torch.nn as nn
from jaxtyping import Float

from search_agent.db import (
    EMBEDDING_DIMENSION,
    NUM_SELECTABLE_LEXICAL_KEYS,
    NUM_WINK_POS_TAGS,
)
from search_agent.search.deep_learn.model import EvaluationMetrics, MyModel


PAIR_INTERACTION_FEATURE_COUNT = 2 * EMBEDDING_DIMENSION + 3
COST_FEATURE_COSINE_EPSILON = 1e-12
COST_FEATURE_COUNT = (
    2 * EMBEDDING_DIMENSION
    + PAIR_INTERACTION_FEATURE_COUNT
    + NUM_SELECTABLE_LEXICAL_KEYS
    + NUM_WINK_POS_TAGS
    + 1
)

UNREACHABLE_COST_LABEL = -1.0
# Shortest-path costs are non-negative, so negative labels are reserved for
# unreachable pairs and can be masked out of cost-regression terms.
REACHABLE_COST_LABEL_MIN = 0.0

type CostFeatureBatch = Float[t.Tensor, f"batch_size {COST_FEATURE_COUNT}"]
type CostLabelBatch = Float[t.Tensor, "batch_size"]


class CostPrediction(NamedTuple):
    """Per-row outputs for reachable cost and reachability classification.

    ``reachable_logit`` stays in logit space so training can use the stable
    combined sigmoid/BCE operation and inference can threshold it directly.
    """

    cost: CostLabelBatch
    reachable_logit: CostLabelBatch

   


@dataclass(slots=True)
class CostEvaluation(EvaluationMetrics):
    """Validation metrics for reachable cost and binary reachability."""

    reachable_cost_mae: float
    reachable_cost_residual_std: float
    reachable_cost_r2: float
    reachability_precision: float
    reachability_recall: float
    reachability_specificity: float

    @property
    def eval_score(self) -> float:
        """Use reachable-row cost error as the checkpoint score."""
        return self.reachable_cost_mae


type CostLossFn = Callable[[CostPrediction, CostLabelBatch], t.Tensor]
type CostEvalFn = Callable[[CostPrediction, CostLabelBatch], CostEvaluation]


def write_pair_interactions(
    features: Float[np.ndarray, "batch_size n_features"],
    offset: int,
    left_embedding: Float[np.ndarray, f"batch_size {EMBEDDING_DIMENSION}"],
    right_embedding: Float[np.ndarray, f"batch_size {EMBEDDING_DIMENSION}"],
) -> int:
    """Append pair geometry to a caller-owned feature matrix.

    Args:
        features: Matrix whose columns after ``offset`` are writable.
        offset: First free output column.
        left_embedding: Left endpoint embedding for every row.
        right_embedding: Right endpoint embedding for every row.

    Returns:
        First free column after the appended interaction features.
    """
    left = np.asarray(left_embedding, dtype=np.float32)
    right = np.asarray(right_embedding, dtype=np.float32)

    # Fill the caller-owned feature matrix in fixed-width blocks.
    difference = features[:, offset : offset + EMBEDDING_DIMENSION]
    np.subtract(right, left, out=difference)
    offset += EMBEDDING_DIMENSION

    product = features[:, offset : offset + EMBEDDING_DIMENSION]
    np.multiply(left, right, out=product)
    offset += EMBEDDING_DIMENSION

    # Scalar geometry complements the vector interactions above.
    dot_product = product.sum(axis=1)
    features[:, offset] = dot_product / (
        np.sqrt(np.einsum("ij,ij->i", left, left))
        * np.sqrt(np.einsum("ij,ij->i", right, right))
        + COST_FEATURE_COSINE_EPSILON
    )
    offset += 1
    features[:, offset] = np.sqrt(np.einsum("ij,ij->i", difference, difference))
    offset += 1
    features[:, offset] = dot_product
    return offset + 1


def build_cost_features(
    current_embedding: Float[np.ndarray, f"batch_size {EMBEDDING_DIMENSION}"],
    target_embedding: Float[np.ndarray, f"batch_size {EMBEDDING_DIMENSION}"],
    lemmatized: bool,
    lexical_field_mask: Float[np.ndarray, f"{NUM_SELECTABLE_LEXICAL_KEYS}"],
    pos_mask: Float[np.ndarray, f"{NUM_WINK_POS_TAGS}"],
) -> CostFeatureBatch:
    """Build model inputs from endpoint embeddings and graph settings.

    Args:
        current_embedding: Current-word embedding for each candidate row.
        target_embedding: Target-word embedding aligned with each candidate.
        lemmatized: Whether the graph uses lemmatized link targets.
        lexical_field_mask: Enabled lexical fields in enum declaration order.
        pos_mask: Enabled POS tags in enum declaration order.

    Returns:
        Float tensor using the feature layout shared by training and inference.
    """
    current = np.asarray(current_embedding, dtype=np.float32)
    target = np.asarray(target_embedding, dtype=np.float32)
    features = np.empty((current.shape[0], COST_FEATURE_COUNT), dtype=np.float32)
    offset = 0

    # Raw endpoints let the network learn absolute-position effects.
    features[:, offset : offset + EMBEDDING_DIMENSION] = current
    offset += EMBEDDING_DIMENSION
    features[:, offset : offset + EMBEDDING_DIMENSION] = target
    offset += EMBEDDING_DIMENSION

    # Pair geometry and search constraints complete the training-time layout.
    offset = write_pair_interactions(features, offset, current, target)
    features[:, offset] = float(lemmatized)
    offset += 1
    features[:, offset : offset + NUM_SELECTABLE_LEXICAL_KEYS] = lexical_field_mask
    offset += NUM_SELECTABLE_LEXICAL_KEYS
    features[:, offset:] = pos_mask
    return t.from_numpy(features)


class CostApproximationLoss(nn.Module):
    """Combine reachable-only cost regression with reachability classification."""

    def __init__(
        self, reachability_weight: float = 0.5, balance_reachability: bool = True
    ):
        """Configure the joint loss.

        Args:
            reachability_weight: Multiplier for the reachability BCE term.
            balance_reachability: Whether to balance BCE from batch class counts.
        """
        super().__init__()
        self.reachability_weight = reachability_weight
        self.balance_reachability = balance_reachability
        self.cost_loss_fn = nn.SmoothL1Loss(reduction="none")

    def forward(self, prediction: CostPrediction, labels: CostLabelBatch) -> t.Tensor:
        """Return the scalar joint loss for one labeled batch.

        Args:
            prediction: Cost estimates and raw reachability logits.
            labels: Non-negative costs or the unreachable sentinel.

        Returns:
            Reachable-only SmoothL1 cost loss plus weighted reachability BCE.
        """
        reachable = labels >= REACHABLE_COST_LABEL_MIN
        reachable_count = reachable.sum().clamp_min(1)
        cost_error = self.cost_loss_fn(prediction.cost, labels)
        cost_loss = cost_error.masked_fill(~reachable, 0.0).sum() / reachable_count

        # BCEWithLogitsLoss applies sigmoid internally using a stable formula.
        reachability_target = reachable.to(dtype=prediction.reachable_logit.dtype)
        reachable_examples = reachable.sum().to(dtype=prediction.reachable_logit.dtype)
        unreachable_examples = (~reachable).sum().to(
            dtype=prediction.reachable_logit.dtype
        )
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
        return cost_loss + self.reachability_weight * reachability_loss


class CostApproximationEval(nn.Module):
    """Compute validation metrics for the model's two prediction heads."""

    def __init__(self, reachability_threshold: float = 0.0):
        """Configure the logit cutoff used for reachability metrics.

        Args:
            reachability_threshold: Logit treated as the reachable cutoff.
        """
        super().__init__()
        self.reachability_threshold = reachability_threshold

    def forward(
        self, prediction: CostPrediction, labels: CostLabelBatch
    ) -> CostEvaluation:
        """Return cost and reachability metrics for one batch.

        Args:
            prediction: Cost estimates and raw reachability logits.
            labels: Non-negative costs or the unreachable sentinel.

        Returns:
            Typed cost regression and reachability classification metrics.
        """
        reachable = labels >= REACHABLE_COST_LABEL_MIN
        metric_dtype = prediction.reachable_logit.dtype
        reachable_count = reachable.sum().clamp_min(1)
        cost_residual = prediction.cost.sub(labels).masked_fill(~reachable, 0.0)
        reachable_cost_mae = cost_residual.abs().sum() / reachable_count
        reachable_cost_bias = cost_residual.sum() / reachable_count
        reachable_cost_residual_variance = (
            cost_residual.square().sum() / reachable_count
            - reachable_cost_bias.square()
        ).clamp_min(0.0)
        reachable_cost_residual_std = reachable_cost_residual_variance.sqrt()

        # A zero logit threshold is equivalent to sigmoid(logit) >= 0.5.
        predicted_reachable = prediction.reachable_logit >= self.reachability_threshold
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

        return CostEvaluation(
            reachable_cost_mae=float(reachable_cost_mae.detach()),
            reachable_cost_residual_std=float(reachable_cost_residual_std.detach()),
            reachable_cost_r2=float(reachable_cost_r2.detach()),
            reachability_precision=float((true_positive / predicted_count).detach()),
            reachability_recall=float((true_positive / reachable_count).detach()),
            reachability_specificity=float((true_negative / unreachable_count).detach()),
        )


class CostApproximation(
    MyModel[CostFeatureBatch, CostLabelBatch, CostPrediction, CostEvaluation]
):
    """Predict current-target reachability and reachable shortest-path cost."""

    SHARED_WIDTH_FLOOR = 256
    HEAD_WIDTH_FLOOR = 64
    WIDTH_SHRINK_FACTOR = 2
    OUTPUT_WIDTH = 1

    @classmethod
    def load_model(cls, model_path: Path, device: t.device) -> "CostApproximation":
        model = cls()
        parameters = t.load(model_path, map_location=device)
        model.load_state_dict(parameters)
        model.to(device)
        return model

    def __init__(self, loss_fn: CostLossFn = CostApproximationLoss(), eval_fn: CostEvalFn = CostApproximationEval()):
        """Build the shared trunk and task-specific heads.

        Args:
            loss_fn: Joint loss used by the inherited training loop.
            eval_fn: Metric calculator used by the inherited evaluation loop.
        """
        super().__init__(loss_fn=loss_fn, eval_fn=eval_fn)
        shared_widths = self._halving_widths(COST_FEATURE_COUNT, self.SHARED_WIDTH_FLOOR)
        shared_output_width = shared_widths[-1]
        head_widths = self._halving_widths(shared_output_width, self.HEAD_WIDTH_FLOOR)

        # Attribute names are part of the persisted state-dict key layout.
        self.model = self._mlp(COST_FEATURE_COUNT, shared_widths)
        self.cost_head = self._mlp(
            shared_output_width, [*head_widths[1:], self.OUTPUT_WIDTH]
        )
        self.reachable_head = self._mlp(
            shared_output_width, [*head_widths[1:], self.OUTPUT_WIDTH]
        )

    @classmethod
    def _halving_widths(cls, input_width: int, floor: int) -> list[int]:
        """Return hidden widths that halve until reaching ``floor``.

        Args:
            input_width: Width before the first generated layer.
            floor: Smallest generated width.

        Returns:
            Monotonically shrinking widths, including ``input_width``.
        """
        widths = [input_width]
        while widths[-1] > floor:
            widths.append(widths[-1] // cls.WIDTH_SHRINK_FACTOR)
        return widths

    @staticmethod
    def _mlp(input_width: int, output_widths: list[int]) -> nn.Sequential:
        """Build a ReLU MLP ending at the last requested width.

        Args:
            input_width: Width consumed by the first linear layer.
            output_widths: Output width for every successive linear layer.

        Returns:
            Sequential linear network with ReLUs between layers.
        """
        layers: list[nn.Module] = []
        for width in output_widths:
            layers.append(nn.Linear(input_width, width))
            if width != output_widths[-1]:
                layers.append(nn.ReLU())
            input_width = width
        return nn.Sequential(*layers)

    def forward(self, input: t.Tensor) -> CostPrediction:
        """Return one cost and raw reachability logit for each input row."""
        features = self.model(input)
        return CostPrediction(
            cost=self.cost_head(features).squeeze(-1),
            reachable_logit=self.reachable_head(features).squeeze(-1),
        )

