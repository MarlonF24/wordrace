import shutil, json

from dataclasses import dataclass
from quark.onnx import ModelQuantizer, QConfig
from pathlib import Path
from transformers import AutoTokenizer
import numpy as np
from sqlalchemy.future import select
from sqlalchemy.sql.expression import func

from search_agent.db.ML.npu.export_fixed import MODEL_INFO_JSON_NAME, FixedModelInfo
from search_agent.db.dictionary import Words
from search_agent.db.db import ASYNC_SESSION_MAKER

from search_agent.logger import logger

FILE_DIR = Path(__file__).parent
# 1. Define your model paths


@dataclass
class QuantFixedModelInfo(FixedModelInfo):
    quantization_profile: str


async def quantize_model(
    model_path: Path,
    quantization_profile: str = "INT8_TRANSFORMER_DEFAULT",
    n_calib_batches: int = 5,
):

    with open(model_path.parent / MODEL_INFO_JSON_NAME, "r") as f:
        model_info: FixedModelInfo = FixedModelInfo(**json.load(f))

    quant_model_path = (
        model_path.parent
        / quantization_profile
        / f"{model_path.stem}_{quantization_profile}.onnx"
    )
    calib_data_dir = quant_model_path.parent / "calib_data"
    calib_input_ids = calib_data_dir / "input_ids"
    calib_attention_mask = calib_data_dir / "attention_mask"

    # 2. Use INT8_TRANSFORMER_DEFAULT for better performance on Ryzen AI NPU
    # This profile is significantly faster than 'ACCURATE' as it uses simplified quantization math
    # that is more likely to be fully accelerated by the NPU.
    quant_config = QConfig.get_default_config(quantization_profile)

    logger.info("Preparing calibration data files...")

    tokenizer = AutoTokenizer.from_pretrained(str(model_info.hg_model_path))

    # Ensure directories exist and are clean
    if calib_input_ids.exists():
        shutil.rmtree(calib_input_ids)
    if calib_attention_mask.exists():
        shutil.rmtree(calib_attention_mask)

    calib_input_ids.mkdir(parents=True, exist_ok=True)
    calib_attention_mask.mkdir(parents=True, exist_ok=True)

    # Sample more diverse words (e.g., 5 batches of 512)
    async with ASYNC_SESSION_MAKER() as session:
        for b in range(n_calib_batches):
            word_sample = await session.execute(
                select(Words.word)
                .where(~Words.word.like("% %"))
                .order_by(func.random())
                .limit(model_info.batch_size)
            )
            word_sample = [r[0] for r in word_sample]

            encoded = tokenizer(
                word_sample,
                padding="max_length",
                truncation=True,
                max_length=model_info.seq_len,
                return_tensors="np",
            )

            # Save multiple calibration files
            np.save(
                calib_input_ids / f"calib_{b}.npy",
                encoded["input_ids"].astype(np.int64),
            )
            np.save(
                calib_attention_mask / f"calib_{b}.npy",
                encoded["attention_mask"].astype(np.int64),
            )

    logger.info(f"Generated {n_calib_batches} batches of calibration data.")

    # 4. Create the quantizer
    quantizer = ModelQuantizer(quant_config)

    # 5. Perform the quantization
    quantizer.quantize_model(
        model_input=str(model_path),
        model_output=str(quant_model_path),
        calibration_data_path=str(calib_data_dir),
    )

    with open(quant_model_path.parent / MODEL_INFO_JSON_NAME, "w") as f:
        json.dump(
            QuantFixedModelInfo(
                hg_model_path=model_info.hg_model_path,
                quantization_profile=quantization_profile,
                batch_size=model_info.batch_size,
                seq_len=model_info.seq_len,
                onnx_path=str(quant_model_path),
            ).__dict__,
            f,
            indent=4,
        )

    logger.info(f"Quantized model successfully saved to: {quant_model_path}")

    return quant_model_path


if __name__ == "__main__":
    pass
