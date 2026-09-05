"""Shared tensor dataset utilities for generated graph-learning data."""

from __future__ import annotations

import time
from abc import abstractmethod
from collections.abc import Iterable, Iterator, Sequence, Sized
from pathlib import Path
from typing import NamedTuple, Self, cast, overload

import numpy as np
import torch as t
from jaxtyping import Float
from matplotlib.figure import Figure
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from torch.utils.data import (
    BatchSampler,
    Dataset,
    IterableDataset,
    RandomSampler,
    SequentialSampler,
    get_worker_info,
)
from tqdm.auto import tqdm

from search_agent.db import (
    EMBEDDING_DIMENSION,
    NUM_SELECTABLE_LEXICAL_KEYS,
    NUM_WINK_POS_TAGS,
    SYNC_SESSION_MAKER,
    Embeddings,
    SelectableLexicalKey,
    WinkPosTag,
)
from search_agent.search.igraph import IgraphSearch

DATASET_FORMAT_VERSION = 2

SELECTABLE_LEXICAL_KEYS = tuple(SelectableLexicalKey)
WINK_POS_TAGS = tuple(WinkPosTag)


class EmbeddingCache(NamedTuple):
    """Random DB sample reused while generating several search batches."""

    words: tuple[str, ...]
    embeddings: Float[np.ndarray, f"n_embeddings {EMBEDDING_DIMENSION}"]


class CostSearchSettings(NamedTuple):
    """One sampled graph configuration represented for search and features."""

    lemmatized: bool
    lexical_field_mask: Float[np.ndarray, f"{NUM_SELECTABLE_LEXICAL_KEYS}"]
    lexical_fields: set[SelectableLexicalKey]
    pos_mask: Float[np.ndarray, f"{NUM_WINK_POS_TAGS}"]
    available_pos: set[WinkPosTag]


def sample_nonempty_mask(
    rng: np.random.Generator,
    size: int,
    prob_yes: float,
) -> Float[np.ndarray, "size"]:
    """Sample independent binary choices while guaranteeing one enabled item.

    Args:
        rng: Random generator that owns the sample.
        size: Number of independent choices.
        prob_yes: Probability that each choice is enabled.

    Returns:
        Dense binary mask with exactly ``size`` entries.
    """
    mask = (rng.random(size) < prob_yes).astype(np.float32)
    if not mask.any():
        mask[int(rng.integers(size))] = 1.0
    return mask


def load_embedding_cache(
    sync_session: Session,
    cache_size: int,
) -> EmbeddingCache:
    """Load a random embedding cache for generated datasets.

    Args:
        sync_session: Open synchronous SQLAlchemy session used for the sample.
        cache_size: Number of word/embedding rows to keep in memory.

    Returns:
        Sampled words and their embeddings in matching order.
    """
    stmt = (
        select(Embeddings.word, Embeddings.embedding)
        .order_by(func.random())
        .limit(cache_size)
    )
    rows = sync_session.execute(stmt).all()
    assert len(rows) == cache_size, (
        f"Expected {cache_size} embedding rows, got {len(rows)}."
    )

    words, embeddings = zip(*rows)
    return EmbeddingCache(
        words=words, embeddings=np.asarray(embeddings, dtype=np.float32)
    )


def sample_lexical_field_mask(
    rng: np.random.Generator,
    prob_yes: float = 0.8,
) -> Float[np.ndarray, f"{NUM_SELECTABLE_LEXICAL_KEYS}"]:
    """Sample the lexical fields allowed during one search-labeling call.

    Args:
        rng: Random generator that owns reproducibility for this worker.
        prob_yes: Independent probability that each lexical field is enabled.

    Returns:
        Dense binary mask with at least one enabled lexical field.
    """
    return sample_nonempty_mask(rng, NUM_SELECTABLE_LEXICAL_KEYS, prob_yes)


def sample_pos_mask(
    rng: np.random.Generator,
    prob_yes: float = 0.8,
) -> Float[np.ndarray, f"{NUM_WINK_POS_TAGS}"]:
    """Sample enabled Wink POS tags with at least one available tag.

    Args:
        rng: Random generator that owns reproducibility for this worker.
        prob_yes: Independent probability that each POS tag is enabled.

    Returns:
        Dense binary mask aligned with the ``WinkPosTag`` enum order.
    """
    return sample_nonempty_mask(rng, NUM_WINK_POS_TAGS, prob_yes)


def sample_cost_search_settings(
    rng: np.random.Generator,
    lexical_field_prob_yes: float = 0.8,
    pos_prob_yes: float = 0.8,
) -> CostSearchSettings:
    """Sample one graph configuration for generated labels and features.

    Args:
        rng: Random generator used for lemmatization and constraint choices.
        lexical_field_prob_yes: Probability passed to ``sample_lexical_field_mask``.
        pos_prob_yes: Probability passed to ``sample_pos_mask``.

    Returns:
        Search settings represented both as model features and search options.
    """
    lexical_field_mask = sample_lexical_field_mask(rng, lexical_field_prob_yes)
    pos_mask = sample_pos_mask(rng, pos_prob_yes)
    lemmatized_choice_count = 2
    # Keep set forms for search and dense masks for the matching model features.
    lexical_fields = {
        key
        for key, enabled in zip(
            SELECTABLE_LEXICAL_KEYS,
            lexical_field_mask,
            strict=True,
        )
        if bool(enabled)
    }
    available_pos = {
        tag for tag, enabled in zip(WINK_POS_TAGS, pos_mask, strict=True) if bool(enabled)
    }
    return CostSearchSettings(
        lemmatized=bool(rng.integers(lemmatized_choice_count)),
        lexical_field_mask=lexical_field_mask,
        lexical_fields=lexical_fields,
        pos_mask=pos_mask,
        available_pos=available_pos,
    )


def get_worker_rng_seed(rng_seed: int | None) -> int | None:
    """Return a worker-specific seed for generated dataset iteration.

    Args:
        rng_seed: Optional base seed supplied by the caller.

    Returns:
        ``None`` when no deterministic seed was requested, the base seed in the
        main process, or the base seed offset by the DataLoader worker id.
    """
    worker_info = get_worker_info()
    if rng_seed is None or worker_info is None:
        return rng_seed
    # IterableDataset is copied into each worker process. Offsetting the seed
    # keeps reproducible runs reproducible without making every worker replay
    # the same random stream.
    return rng_seed + worker_info.id


type FeatureBatch = Float[t.Tensor, "batch_size n_features"]
type LabelBatch = Float[t.Tensor, "batch_size"]


class GenerationThroughput(NamedTuple):
    """Measured generated-dataset throughput."""

    batches: int
    instances: int
    embedding_cache_size: int
    seconds: float
    instances_per_second: float


def make_index_batch_sampler(
    data_source: Sized,
    batch_size: int,
    shuffle: bool = True,
    drop_last: bool = False,
    generator: t.Generator | None = None,
) -> BatchSampler:
    """Group indices for the direct-slicing DataLoader path.

    ``data_source`` must be the same object passed to ``DataLoader``. For a
    ``random_split`` result, that means the ``Subset`` itself, because its
    indices are split-local and then remapped to the original map dataset.
    """
    index_sampler = (
        RandomSampler(data_source, generator=generator)
        if shuffle
        else SequentialSampler(data_source)
    )
    return BatchSampler(index_sampler, batch_size, drop_last)


class GeneratedIterTensorDataset[TF: FeatureBatch, TL: LabelBatch](
    IterableDataset[tuple[TF, TL]]
):
    """Infinite stream of model-ready batches produced from DB/search state."""

    def __init__(
        self,
        rng_seed: int | None = None,
        batches_per_shuffle: int | None = 8,
        batches_in_embedding_cache: int = 64,
        lexical_field_prob_yes: float = 0.8,
        pos_prob_yes: float = 0.8,
    ):
        """Configure generation and optional cross-batch row shuffling.

        Args:
            rng_seed: Optional base seed. DataLoader workers receive offset
                seeds so they do not replay the same random stream.
            batches_per_shuffle: Number of generated batches to concatenate and
                row-shuffle before yielding. ``None`` yields each generated
                batch directly.
            batches_in_embedding_cache: Number of generated batches whose
                embedding rows should fit in the per-worker cache.
            lexical_field_prob_yes: Probability that each lexical field is
                enabled while sampling a search graph configuration.
            pos_prob_yes: Probability that each Wink POS tag is enabled while
                sampling a search graph configuration.
        """
        assert batches_per_shuffle is None or batches_per_shuffle > 0, (
            f"batches_per_shuffle must be positive or None, got {batches_per_shuffle}."
        )
        assert batches_in_embedding_cache > 0, (
            f"batches_in_embedding_cache must be positive, got {batches_in_embedding_cache}."
        )
        assert 0.0 <= lexical_field_prob_yes <= 1.0, (
            f"lexical_field_prob_yes must be in [0, 1], got {lexical_field_prob_yes}."
        )
        assert 0.0 <= pos_prob_yes <= 1.0, (
            f"pos_prob_yes must be in [0, 1], got {pos_prob_yes}."
        )
        super().__init__()
        self.rng_seed = rng_seed
        self.batches_per_shuffle = batches_per_shuffle
        self.batches_in_embedding_cache = batches_in_embedding_cache
        self.lexical_field_prob_yes = lexical_field_prob_yes
        self.pos_prob_yes = pos_prob_yes

    @property
    @abstractmethod
    def embedding_rows_per_batch(self) -> int:
        """Number of cached embedding rows consumed by one generated batch."""

    @abstractmethod
    def generate_batch(
        self,
        embedding_cache: EmbeddingCache,
        search: IgraphSearch,
        rng: np.random.Generator,
        search_settings: CostSearchSettings,
    ) -> tuple[TF, TL]:
        """Generate one labeled tensor batch under one graph setting.

        Args:
            embedding_cache: Per-worker random embedding sample.
            search: Reused shortest-path search object with graph caches.
            rng: Worker-local random generator.
            search_settings: Graph options used for labels and feature columns.

        Returns:
            Model-ready feature and label tensors with matching first dimension.
        """

    def benchmark_throughput(
        self, n_batches: int = 3, warmup_batches: int = 4
    ) -> GenerationThroughput:
        """Measure steady-state generation throughput after graph/cache warmup.

        Args:
            n_batches: Number of timed batches.
            warmup_batches: Untimed batches used to populate caches and avoid
                first-call setup cost in the measurement.

        Returns:
            Counts and elapsed time for the measured generation window.
        """
        # Use the same generator/cache/search path as training, but discard
        # warmup timings so graph construction and cache effects do not dominate.
        rng = np.random.default_rng(get_worker_rng_seed(self.rng_seed))
        search_settings = sample_cost_search_settings(
            rng,
            lexical_field_prob_yes=self.lexical_field_prob_yes,
            pos_prob_yes=self.pos_prob_yes,
        )
        measured_instances = 0
        embedding_cache_size = (
            self.batches_in_embedding_cache * self.embedding_rows_per_batch
        )

        with SYNC_SESSION_MAKER() as sync_session:
            search = IgraphSearch()
            embedding_cache = load_embedding_cache(sync_session, embedding_cache_size)
            self.generate_batch(embedding_cache, search, rng, search_settings)

            for _ in range(warmup_batches):
                self.generate_batch(embedding_cache, search, rng, search_settings)

            start_time = time.perf_counter()
            for _ in range(n_batches):
                _, labels = self.generate_batch(
                    embedding_cache, search, rng, search_settings
                )
                measured_instances += labels.shape[0]
            elapsed_seconds = time.perf_counter() - start_time

        stats = GenerationThroughput(
            batches=n_batches,
            instances=measured_instances,
            embedding_cache_size=embedding_cache_size,
            seconds=elapsed_seconds,
            instances_per_second=measured_instances / elapsed_seconds,
        )
        print(stats)
        return stats

    def __iter__(self) -> Iterator[tuple[TF, TL]]:
        """Yield an infinite stream of generated feature/label batches.

        Each DataLoader worker opens its own DB session, graph search object,
        embedding cache, and random generator. When ``batches_per_shuffle`` is
        set, rows from several fixed-setting batches are mixed before yielding.
        """
        # Each DataLoader worker owns its generator so multiprocessing does not
        # replay identical samples across workers.
        rng = np.random.default_rng(get_worker_rng_seed(self.rng_seed))

        with SYNC_SESSION_MAKER() as sync_session:
            # Reuse expensive DB/search/cache state for this worker iterator.
            search = IgraphSearch()
            embedding_cache = load_embedding_cache(
                sync_session,
                self.batches_in_embedding_cache * self.embedding_rows_per_batch,
            )

            while True:
                if self.batches_per_shuffle is None:
                    # Fast path: subclasses already return model-ready batches.
                    yield self.generate_batch(
                        embedding_cache=embedding_cache,
                        search=search,
                        rng=rng,
                        search_settings=sample_cost_search_settings(
                            rng,
                            lexical_field_prob_yes=self.lexical_field_prob_yes,
                            pos_prob_yes=self.pos_prob_yes,
                        ),
                    )
                    continue

                feature_batches: list[t.Tensor] = []
                label_batches: list[t.Tensor] = []

                # Mix rows across several fixed-setting batches when requested.
                for _ in range(self.batches_per_shuffle):
                    features, labels = self.generate_batch(
                        embedding_cache=embedding_cache,
                        search=search,
                        rng=rng,
                        search_settings=sample_cost_search_settings(
                            rng,
                            lexical_field_prob_yes=self.lexical_field_prob_yes,
                            pos_prob_yes=self.pos_prob_yes,
                        ),
                    )
                    feature_batches.append(features)
                    label_batches.append(labels)

                features = t.cat(feature_batches)
                labels = t.cat(label_batches)

                # Shuffle rows after concatenation so fixed-setting matrix
                # batches do not reach the model as large contiguous blocks.
                order = rng.permutation(labels.shape[0])
                features = features[order]
                labels = labels[order]

                yield cast(tuple[TF, TL], (features, labels))


class NumericStats(NamedTuple):
    """Finite-value summary for one numeric tensor."""

    value_count: int
    finite_count: int
    nonfinite_count: int
    min: float | None
    max: float | None
    mean: float | None
    std: float | None
    quantiles: dict[float, float]


class LabelDescription(NamedTuple):
    """Label statistics plus sentinel-class balance when a sentinel exists."""

    stats: NumericStats
    sentinel_label: float | None = None
    sentinel_count: int | None = None
    sentinel_ratio: float | None = None
    non_sentinel: NumericStats | None = None


class FeatureDescription(NamedTuple):
    """Feature matrix shape and finite-value counts."""

    shape: tuple[int, ...]
    feature_count: int
    finite_count: int
    nonfinite_count: int


class TensorDatasetDescription(NamedTuple):
    """Typed summary returned by tensor-backed map datasets."""

    kind: str
    examples: int
    feature_count: int
    labels: LabelDescription
    features: FeatureDescription | None = None


type TensorSample = tuple[Float[t.Tensor, "n_features"], Float[t.Tensor, ""]]
type TensorIndexBatch = Sequence[int] | slice | t.Tensor | np.ndarray


def describe_numeric_tensor(values: t.Tensor) -> NumericStats:
    """Summarize finite values and count excluded non-finite values.

    Args:
        values: Tensor of numeric values to inspect.

    Returns:
        Count, moment, and quantile statistics computed on finite values only.
    """
    flat_values = values.detach().cpu().reshape(-1)
    finite_values = flat_values[t.isfinite(flat_values)]
    value_count = flat_values.numel()
    finite_count = finite_values.numel()
    nonfinite_count = value_count - finite_count
    # Empty finite sets cannot provide numeric moments or quantiles.
    if finite_count == 0:
        return NumericStats(
            value_count=value_count,
            finite_count=finite_count,
            nonfinite_count=nonfinite_count,
            min=None,
            max=None,
            mean=None,
            std=None,
            quantiles={},
        )

    quantile_points = (0.0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1.0)
    # Quantiles stay in one dict so callers can choose the cutoffs they need.
    quantiles = t.quantile(
        finite_values, t.tensor(quantile_points, dtype=finite_values.dtype)
    )
    return NumericStats(
        value_count=value_count,
        finite_count=finite_count,
        nonfinite_count=nonfinite_count,
        min=float(finite_values.min()),
        max=float(finite_values.max()),
        mean=float(finite_values.mean()),
        std=float(finite_values.std()) if finite_count > 1 else 0.0,
        quantiles={
            point: float(value)
            for point, value in zip(quantile_points, quantiles, strict=True)
        },
    )


class MapTensorDataset[TF: FeatureBatch, TL: LabelBatch](Dataset[TensorSample]):
    """Finite tensor dataset with single-row and direct batch slicing."""

    KIND = "base_map_dataset"
    SENTINEL_LABEL: float | None = None

    @classmethod
    def validate_feature_count(cls, feature_count: int) -> None:
        """Validate a feature width accepted by this dataset type.

        The shared tensor dataset supports arbitrary feature widths. Concrete
        model datasets override this hook when their feature contract is fixed.
        """

    def __init__(self, features: TF, labels: TL):
        """Store feature and label tensors with a shared first dimension.

        Args:
            features: Feature matrix whose first dimension indexes examples.
            labels: Label vector aligned with ``features``.
        """
        assert features.shape[0] == labels.shape[0], (
            "features and labels must contain the same number of examples, "
            f"got {features.shape[0]} and {labels.shape[0]}."
        )
        assert features.ndim == 2, (
            f"features must be a matrix, got shape {tuple(features.shape)}."
        )
        self.validate_feature_count(features.shape[1])

        # Persist tensors in the dtype expected by PyTorch modules and losses.
        self.features: TF = cast(TF, features.to(dtype=t.float32))
        self.labels: TL = cast(TL, labels.to(dtype=t.float32))

    def __len__(self) -> int:
        """Return the number of examples in the dataset."""
        return self.features.shape[0]

    @overload
    def __getitem__(self, index: int) -> TensorSample:
        """Return one feature/label sample for an integer index."""
        ...

    @overload
    def __getitem__(self, index: TensorIndexBatch) -> tuple[TF, TL]:
        """Return a feature/label batch for batched tensor-compatible indices."""
        ...

    def __getitem__(self, index: int | TensorIndexBatch) -> TensorSample | tuple[TF, TL]:
        """Return one sample for an integer index or one batch for batched indices."""
        features = self.features[index]
        labels = self.labels[index]
        if isinstance(index, int):
            return cast(TensorSample, (features, labels))
        return cast(tuple[TF, TL], (features, labels))

    def make_index_batch_sampler(
        self,
        batch_size: int,
        shuffle: bool = True,
        drop_last: bool = False,
        generator: t.Generator | None = None,
    ) -> BatchSampler:
        """Return grouped indices for direct tensor slicing through DataLoader."""
        return make_index_batch_sampler(self, batch_size, shuffle, drop_last, generator)

    def describe_labels(self, sentinel_label: float | None = None) -> LabelDescription:
        """Return label statistics and optional sentinel balance.

        Args:
            sentinel_label: Optional class marker to count separately from
                ordinary numeric targets. Defaults to the dataset class marker.

        Returns:
            Full-label statistics and, when a sentinel exists, separate
            sentinel/non-sentinel balance information.
        """
        label_sentinel = self.SENTINEL_LABEL if sentinel_label is None else sentinel_label
        labels = self.labels.detach().cpu()
        stats = describe_numeric_tensor(labels)
        if label_sentinel is None:
            return LabelDescription(stats=stats)

        # Sentinel labels are valid class markers, but excluded from ordinary
        # numeric target statistics when a dataset declares one.
        sentinel_mask = labels == label_sentinel
        sentinel_count = int(sentinel_mask.sum())
        label_count = labels.numel()
        return LabelDescription(
            stats=stats,
            sentinel_label=label_sentinel,
            sentinel_count=sentinel_count,
            sentinel_ratio=sentinel_count / label_count if label_count > 0 else 0.0,
            non_sentinel=describe_numeric_tensor(labels[~sentinel_mask]),
        )

    def describe_features(self) -> FeatureDescription:
        """Return feature tensor shape and finite-value health checks."""
        # Feature scans are intentionally separate from label scans because they
        # can be large and are optional in describe().
        finite_feature_count = int(t.isfinite(self.features).sum())
        feature_value_count = self.features.numel()
        return FeatureDescription(
            shape=tuple(self.features.shape),
            feature_count=self.features.shape[1],
            finite_count=finite_feature_count,
            nonfinite_count=feature_value_count - finite_feature_count,
        )

    def describe(
        self,
        sentinel_label: float | None = None,
        include_features: bool = False,
    ) -> TensorDatasetDescription:
        """Return a typed dataset summary.

        Args:
            sentinel_label: Optional label value to count as a class marker.
            include_features: Whether to scan the feature matrix for finite
                values. This is optional because large datasets can be costly.

        Returns:
            Dataset kind, example count, feature count, label summary, and
            optional feature health summary.
        """
        return TensorDatasetDescription(
            kind=self.KIND,
            examples=len(self),
            feature_count=self.features.shape[1],
            labels=self.describe_labels(sentinel_label),
            features=self.describe_features() if include_features else None,
        )

    def plot_label_distribution(
        self,
        sentinel_label: float | None = None,
        bins: int = 40,
        path: Path | None = None,
        show: bool = True,
    ) -> Figure:
        """Plot numeric labels plus sentinel balance when available."""
        import matplotlib.pyplot as plt

        label_sentinel = self.SENTINEL_LABEL if sentinel_label is None else sentinel_label
        labels = self.labels.detach().cpu()
        histogram_figure_size = (10.0, 4.0)
        diagnostic_figure_size = (12.0, 4.0)
        subplot_row_count = 1
        subplot_column_count = 2
        center_position = 0.5

        # Datasets without sentinel labels get a plain target histogram.
        if label_sentinel is None:
            figure, axis = plt.subplots(figsize=histogram_figure_size)
            axis.hist(labels.numpy(), bins=bins)
            axis.set_title(f"{self.KIND} labels")
            axis.set_xlabel("label")
            axis.set_ylabel("count")
        else:
            # Sentinel datasets show numeric targets and class balance separately.
            sentinel_mask = labels == label_sentinel
            non_sentinel_labels = labels[~sentinel_mask]
            figure, (hist_axis, balance_axis) = plt.subplots(
                subplot_row_count,
                subplot_column_count,
                figsize=diagnostic_figure_size,
            )
            if non_sentinel_labels.numel() > 0:
                hist_axis.hist(non_sentinel_labels.numpy(), bins=bins)
            else:
                hist_axis.text(
                    center_position,
                    center_position,
                    "no non-sentinel labels",
                    ha="center",
                    va="center",
                )
            hist_axis.set_title("non-sentinel labels")
            hist_axis.set_xlabel("label")
            hist_axis.set_ylabel("count")

            sentinel_count = int(sentinel_mask.sum())
            non_sentinel_count = labels.numel() - sentinel_count
            balance_axis.bar(
                ["non-sentinel", f"sentinel {label_sentinel:g}"],
                [non_sentinel_count, sentinel_count],
            )
            balance_axis.set_title("label class balance")
            balance_axis.set_ylabel("count")
            figure.suptitle(f"{self.KIND} label diagnostics")

        figure.tight_layout()
        if path is not None:
            figure.savefig(Path(path), bbox_inches="tight")
        if show:
            plt.show()
        return figure

    def save(self, path: Path) -> None:
        """Persist tensors and compatibility metadata for map-style loading.

        Args:
            path: Output file path. Parent directories are created when needed.
        """
        save_path = Path(path)
        save_path.parent.mkdir(parents=True, exist_ok=True)
        t.save(
            {
                "kind": self.KIND,
                "format_version": DATASET_FORMAT_VERSION,
                "features": self.features,
                "labels": self.labels,
                "feature_count": self.features.shape[1],
            },
            save_path,
        )

    @classmethod
    def load(cls, path: Path) -> Self:
        """Load a persisted tensor map dataset.

        Args:
            path: File created by ``save``.

        Returns:
            Dataset instance containing the saved features and labels.
        """
        payload = t.load(Path(path))
        # Stored metadata prevents accidentally training one model on another
        # model's feature layout or an incompatible serialization format.
        assert (found_kind := payload.get("kind")) == cls.KIND, (
            f"Expected dataset kind {cls.KIND!r}, got {found_kind!r}."
        )
        assert (
            found_format_version := payload.get("format_version")
        ) == DATASET_FORMAT_VERSION, (
            f"Unsupported dataset format version {found_format_version!r}."
        )
        features = payload["features"]
        assert (stored_feature_count := payload.get("feature_count")) == features.shape[
            1
        ], (
            "Stored feature-count metadata does not match the tensor width: "
            f"{stored_feature_count!r} != {features.shape[1]}."
        )
        cls.validate_feature_count(stored_feature_count)

        return cls(features, payload["labels"])

    @classmethod
    def generate_from_iterable(
        cls,
        iterable_dataset: Iterable[tuple[TF, TL]],
        n_examples: int,
        path: Path | None = None,
        description: str = "Generate dataset",
    ) -> Self:
        """Collect generated batches into one finite tensor-backed dataset.

        Args:
            iterable_dataset: Source of already-collated feature/label batches.
            n_examples: Exact number of rows to keep.
            path: Optional path used to save the collected dataset.
            description: Progress-bar label.

        Returns:
            Finite dataset containing exactly ``n_examples`` rows.
        """
        assert n_examples > 0, f"n_examples must be positive, got {n_examples}."

        feature_batches: list[t.Tensor] = []
        label_batches: list[t.Tensor] = []

        progress = tqdm(total=n_examples, desc=description, dynamic_ncols=True)
        for features, labels in iterable_dataset:
            # Generated batches may overshoot the requested finite size. Keep
            # only the prefix still needed for the target example count.
            keep_count = min(labels.shape[0], n_examples - progress.n)

            # Store generated chunks and concatenate once to avoid repeated
            # tensor reallocations during dataset generation.
            feature_batches.append(features[:keep_count])
            label_batches.append(labels[:keep_count])

            progress.update(keep_count)
            if progress.n == n_examples:
                break

        progress.close()
        dataset = cls(cast(TF, t.cat(feature_batches)), cast(TL, t.cat(label_batches)))
        if path is not None:
            dataset.save(path)
        return dataset
