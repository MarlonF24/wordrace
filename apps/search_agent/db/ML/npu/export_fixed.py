import torch, json
from transformers import AutoModel
from pathlib import Path
from search_agent.logger import logger
from dataclasses import dataclass

FILE_DIR = Path(__file__).parent

MODEL_REPO = "sentence-transformers"
MODEL_NAME = "all-MiniLM-L6-v2"


# Config
BATCH_SIZE = 512  # Fixed for NPU optimization
SEQ_LEN = 6  # for single words (we only need to embedd single words, with special tokens like [CLS] and [SEP] 6 is sufficient)

CACHE_DIR = FILE_DIR / "model_cache"

MODEL_INFO_JSON_NAME = "model_info.json"


@dataclass
class FixedModelInfo:
    hg_model_path: str
    batch_size: int
    seq_len: int
    onnx_path: str


def export_fixed_model(
    hg_user: str = MODEL_REPO,
    hg_model_name: str = MODEL_NAME,
    batch_size: int = BATCH_SIZE,
    seq_len: int = SEQ_LEN,
    out_dir: Path = CACHE_DIR,
):

    hg_model_path = f"{hg_user}/{hg_model_name}"

    fixed_model_name = f"{hg_model_name}_b{batch_size}_len{seq_len}"

    fixed_model_path = out_dir / fixed_model_name / f"{fixed_model_name}.onnx"

    fixed_model_path.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"Loading {MODEL_NAME}...")
    # tokenizer = AutoTokenizer.from_pretrained(HG_MODEL_PATH)
    model = AutoModel.from_pretrained(hg_model_path, cache_dir=fixed_model_path.parent)
    model.eval()

    # Create fixed-size dummy input
    dummy_input = {
        "input_ids": torch.ones((batch_size, seq_len), dtype=torch.long),
        "attention_mask": torch.ones((batch_size, seq_len), dtype=torch.long),
    }

    logger.info(f"Exporting to {fixed_model_path} with fixed shapes...")
    torch.onnx.export(
        model,
        (dummy_input["input_ids"], dummy_input["attention_mask"]),
        str(fixed_model_path),
        input_names=["input_ids", "attention_mask"],
        output_names=["embeddings"],
        # We remove dynamic_axes for maximum NPU optimization
        opset_version=14,
        do_constant_folding=True,
    )
    logger.info("Export complete.")

    model_info = FixedModelInfo(
        hg_model_path=hg_model_path,
        batch_size=batch_size,
        seq_len=seq_len,
        onnx_path=str(fixed_model_path),
    )

    with open(fixed_model_path.parent / MODEL_INFO_JSON_NAME, "w") as f:
        json.dump(model_info.__dict__, f, indent=4)

    logger.info(f"Model info saved to {fixed_model_path.parent / MODEL_INFO_JSON_NAME}")

    return fixed_model_path


if __name__ == "__main__":
    export_fixed_model()
