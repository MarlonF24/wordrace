"""Reusable model training and evaluation loop for tensor batch datasets."""

from pathlib import Path
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable, Self

import torch as t
from torch.utils.data import DataLoader
from tqdm.auto import tqdm

from search_agent.search.deep_learn.dataset import FeatureBatch, LabelBatch


@dataclass(slots=True)
class EvaluationMetrics:
    """Base for typed metric bundles returned by ``eval_fn``.

    Subclasses should be dataclasses with numeric fields. ``fit`` averages each
    field across validation batches and uses ``eval_score`` for checkpointing.
    """

    @property
    def eval_score(self) -> float:
        """Primary metric for model selection; lower is better."""
        raise NotImplementedError(
            "EvaluationMetrics subclasses must implement a score property."
        )

    def elementwise(self, other: Self, func: Callable[[float, float], float]) -> Self:
        """Apply ``func`` to matching metric fields and return the same type.

        Args:
            other: Metrics object with the same dataclass fields.
            func: Binary operation applied field by field.

        Returns:
            New metrics object of the concrete subclass.
        """
        return self.__class__(
            **{
                field: func(getattr(self, field), getattr(other, field))
                for field in self.__dataclass_fields__
            }
        )


type BatchLossFn[TP] = Callable[[TP, t.Tensor], t.Tensor]
type BatchEvalFn[TP, TE: EvaluationMetrics] = Callable[[TP, t.Tensor], TE]
type DeviceLike = t.device | str


FILE_DIR = Path(__file__).parent
MODEL_DIR = FILE_DIR / "models"
MODEL_DIR.mkdir(exist_ok=True)


class MyModel[TF: FeatureBatch, TL: LabelBatch, TP, TE: EvaluationMetrics](
    t.nn.Module, ABC
):
    """Base model for loaders that yield already-collated tensor batches.

    The caller owns optimizer, device, and DataLoader configuration. The model
    owns the task-specific forward pass, loss, metric computation, and training
    loop mechanics.
    """

    def __init__(self, loss_fn: BatchLossFn[TP], eval_fn: BatchEvalFn[TP, TE]):
        """Store task-specific training and evaluation callables.

        Args:
            loss_fn: Callable that converts predictions and labels into a
                scalar training loss.
            eval_fn: Callable that converts predictions and labels into typed
                validation metrics.
        """
        super().__init__()
        self.loss_fn = loss_fn
        self.eval_fn = eval_fn

    @abstractmethod
    def forward(self, input: t.Tensor) -> TP:
        """Return task-specific predictions for one feature batch."""
        pass

    def _move_batch(
        self, batch: tuple[TF, TL], device: t.device, non_blocking: bool
    ) -> tuple[t.Tensor, t.Tensor]:
        """Move one feature/label batch to the active training/eval device."""
        features, labels = batch
        # non_blocking only helps when the DataLoader supplied pinned CPU memory.
        return features.to(device, non_blocking=non_blocking), labels.to(
            device, non_blocking=non_blocking
        )

    def evaluate(
        self,
        loader: DataLoader[tuple[TF, TL]],
        device: DeviceLike,
        non_blocking: bool,
        evaluation_steps: int | None = None,
        progress_desc: str = "Eval",
    ) -> TE:
        """Average typed metrics over validation batches.

        ``evaluation_steps`` is required for infinite/generated loaders and left
        as ``None`` for finite map-style loaders.
        """
        assert evaluation_steps is None or evaluation_steps > 0, (
            f"evaluation_steps must be positive or None, got {evaluation_steps}."
        )
        eval_device = t.device(device)
        self.to(eval_device)
        self.eval()

        total_metrics: TE | None = None
        evaluated_batches = 0
        with t.no_grad():
            # Finite validation consumes the loader once; generated validation
            # uses an explicit step count to avoid an infinite loop.
            batch_iterable = (
                loader
                if evaluation_steps is None
                else (batch for _, batch in zip(range(evaluation_steps), loader))
            )
            for batch in tqdm(
                batch_iterable,
                desc=progress_desc,
                leave=True,
                total=evaluation_steps,
                dynamic_ncols=True,
            ):
                features, labels = self._move_batch(batch, eval_device, non_blocking)
                batch_metrics = self.eval_fn(self(features), labels)
                # Metric dataclasses are added field-by-field, then divided
                # once after the loop to produce per-batch means.
                total_metrics = (
                    batch_metrics
                    if total_metrics is None
                    else total_metrics.elementwise(batch_metrics, lambda x, y: x + y)
                )
                evaluated_batches += 1

        assert total_metrics is not None, "evaluation loader yielded no batches."
        return total_metrics.elementwise(
            total_metrics, lambda x, _: x / evaluated_batches
        )

    def fit_batch(
        self,
        batch: tuple[TF, TL],
        optimizer: t.optim.Optimizer,
        device: DeviceLike,
        non_blocking: bool,
    ) -> float:
        """Run one forward/loss/backward/update step.

        Args:
            batch: Feature and label tensors from a DataLoader.
            optimizer: Optimizer whose gradients and parameters are updated.
            device: Device used for this training step.
            non_blocking: Whether tensor transfers may use non-blocking copies.

        Returns:
            Detached scalar loss value for progress reporting.
        """
        features, labels = self._move_batch(batch, t.device(device), non_blocking)
        optimizer.zero_grad(set_to_none=True)
        # Forward pass, scalar loss, backward pass, then one optimizer update.
        pred = self(features)
        loss = self.loss_fn(pred, labels)
        loss.backward()
        optimizer.step()
        return float(loss.detach())

    def fit(
        self,
        train_loader: DataLoader[tuple[TF, TL]],
        val_loader: DataLoader[tuple[TF, TL]],
        optimizer: t.optim.Optimizer,
        device: DeviceLike,
        non_blocking: bool,
        num_epochs: int = 10,
        save_best: bool = True,
        checkpoint_name: str | Path | None = None,
        steps_per_epoch: int | None = None,
        validation_steps: int | None = None,
    ) -> None:
        """Train and optionally save the best checkpoint by validation score.

        Args:
            train_loader: Training batches. Infinite loaders require
                ``steps_per_epoch``.
            val_loader: Validation batches. Infinite loaders require
                ``validation_steps``.
            optimizer: Optimizer updated once per training batch.
            device: Device used for training and validation.
            non_blocking: Whether DataLoader tensor transfers may be
                non-blocking.
            num_epochs: Number of full training/evaluation cycles.
            save_best: Whether to save the lowest-score checkpoint.
            checkpoint_name: Optional file name or path for the best
                checkpoint. Relative names are saved under ``MODEL_DIR``.
            steps_per_epoch: Number of batches per epoch for infinite training
                loaders. ``None`` consumes a finite loader once per epoch.
            validation_steps: Number of validation batches for infinite
                validation loaders. ``None`` consumes a finite loader once.
        """
        assert num_epochs > 0, f"num_epochs must be positive, got {num_epochs}."
        assert steps_per_epoch is None or steps_per_epoch > 0, (
            f"steps_per_epoch must be positive or None, got {steps_per_epoch}."
        )
        assert validation_steps is None or validation_steps > 0, (
            f"validation_steps must be positive or None, got {validation_steps}."
        )

        train_device = t.device(device)
        self.to(train_device)

        best_eval: float | None = None
        checkpoint_path = self.checkpoint_path(checkpoint_name)

        # Infinite train loaders need one persistent iterator so each epoch
        # continues the stream instead of restarting it.
        train_iterator = iter(train_loader) if steps_per_epoch is not None else None

        # The scheduler advances once per epoch after validation.
        lr_scheduler = t.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=num_epochs)

        for epoch in range(num_epochs):
            self.train()
            total_loss = 0.0
            trained_batches = 0
            epoch_label = f"Epoch {epoch + 1}/{num_epochs}"

            # Map-style loaders are finite; generated loaders are bounded by
            # steps_per_epoch and drawn from the persistent iterator above.
            if steps_per_epoch is None:
                train_batches = train_loader
            else:
                assert train_iterator is not None, (
                    "steps_per_epoch requires a training iterator."
                )
                train_batches = (next(train_iterator) for _ in range(steps_per_epoch))

            # Train batches update the model; validation below only scores it.
            for batch in tqdm(
                train_batches,
                desc=f"{epoch_label} Train",
                leave=True,
                total=steps_per_epoch,
                dynamic_ncols=True,
            ):
                total_loss += self.fit_batch(batch, optimizer, train_device, non_blocking)
                trained_batches += 1

            assert trained_batches > 0, "training loader yielded no batches."
            mean_train_loss = total_loss / trained_batches
            val_metrics = self.evaluate(
                val_loader,
                device=train_device,
                non_blocking=non_blocking,
                evaluation_steps=validation_steps,
                progress_desc=f"{epoch_label} Eval",
            )
            lr_scheduler.step()

            # Save only tensors, moved to CPU, so the checkpoint is device-neutral.
            val_score = val_metrics.eval_score
            if best_eval is None or val_score < best_eval:
                best_eval = val_score
                if save_best:
                    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
                    t.save(
                        {
                            name: value.detach().cpu()
                            for name, value in self.state_dict().items()
                        },
                        checkpoint_path,
                    )

            postfix = {
                "train_loss": f"{mean_train_loss:.4f}",
                **{
                    field: f"{getattr(val_metrics, field):.4f}"
                    for field in val_metrics.__dataclass_fields__
                },
            }
            tqdm.write(
                f"{epoch_label}: "
                + ", ".join(f"{field}={value}" for field, value in postfix.items())
            )

    def checkpoint_path(self, checkpoint_name: str | Path | None = None) -> Path:
        """Return the checkpoint path used by ``fit``.

        Args:
            checkpoint_name: Optional checkpoint file name or path. Relative
                paths are resolved inside ``MODEL_DIR``. ``None`` uses the
                conventional best-checkpoint name for the concrete model class.

        Returns:
            Absolute or repository-relative path where the checkpoint is saved.
        """
        checkpoint = Path(
            checkpoint_name
            if checkpoint_name is not None
            else f"best_{self.__class__.__name__}.pt"
        )
        return checkpoint if checkpoint.is_absolute() else MODEL_DIR / checkpoint
