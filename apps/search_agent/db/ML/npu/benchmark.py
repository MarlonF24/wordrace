import time, json
import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer
from pathlib import Path
from typing import List, Dict, Any, Literal


from search_agent.db.ML.npu.export_fixed import MODEL_INFO_JSON_NAME, FixedModelInfo
from search_agent.db.ML.npu.quantize_model import QuantFixedModelInfo
from search_agent.logger import logger

CONFIG_PATH = Path(r"C:\Program Files\RyzenAI\1.7.1\voe-4.0-win_amd64\vaip_config.json")
TEST_WORDS = ["apple", "banana", "car", "truck", "flight", "circus", "king", "queen"]

Provider = Literal["CPUExecutionProvider", "VitisAIExecutionProvider"]


def mean_pooling(token_embeddings, attention_mask):
    # mask has 1 for real tokens and 0 for padding and special tokens
    input_mask_expanded = np.expand_dims(attention_mask, -1).astype(float)
    sum_embeddings = np.sum(
        token_embeddings * input_mask_expanded, 1
    )  # sum of embeddings
    sum_mask = np.clip(
        input_mask_expanded.sum(1), a_min=1e-9, a_max=None
    )  # num of real tokens, but avoid division by zero with min
    return sum_embeddings / sum_mask


def run_throughput_benchmark(
    model_path: Path, provider: Provider, inputs, batch_size: int, n: int = 200
):
    session_options = ort.SessionOptions()
    session_options.log_severity_level = 0  # verbose

    match provider:
        case "VitisAIExecutionProvider":
            options = {
                "config_file": str(CONFIG_PATH),
                "cache_dir": str(model_path.parent.parent),
                "cache_key": str(model_path.parent),
                "enable_cache_file_io_in_mem": 0,
            }
            session = ort.InferenceSession(
                str(model_path),
                sess_options=session_options,
                providers=[provider],
                provider_options=[options],
            )
        case "CPUExecutionProvider":
            session = ort.InferenceSession(
                str(model_path), sess_options=session_options, providers=[provider]
            )

    session.run(None, inputs)
    start = time.perf_counter()
    for _ in range(n):
        session.run(None, inputs)
    end = time.perf_counter()
    avg_time = (end - start) / n
    return avg_time, batch_size / avg_time


def run_vector_analysis(
    model_path: Path, tokenizer, test_words: List[str], model_info: QuantFixedModelInfo
) -> Dict[str, Any]:
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])

    # Get model input names to filter out unsupported keys (like token_type_ids)
    model_inputs = {i.name for i in session.get_inputs()}

    input_words = test_words + ["pad"] * (model_info.batch_size - len(test_words))
    encoded = tokenizer(
        input_words,
        padding="max_length",
        max_length=model_info.seq_len,
        truncation=True,
        return_tensors="np",
    )

    inputs = {k: v.astype(np.int64) for k, v in encoded.items() if k in model_inputs}
    outputs = session.run(None, inputs)
    token_embeddings = outputs[0]

    cls_vectors = token_embeddings[: len(test_words), 0, :]
    mean_vectors = mean_pooling(token_embeddings, encoded["attention_mask"])[
        : len(test_words), :
    ]

    return {
        "cls_var": np.var(cls_vectors),
        "mean_var": np.var(mean_vectors),
    }


PROVIDERS: List[Provider] = ["VitisAIExecutionProvider", "CPUExecutionProvider"]


def evaluate_models(model_paths: List[Path], n_iters: int = 100):
    results = []
    for path in model_paths:
        if not path.exists():
            logger.warning(f"Model file not found: {path}")
            continue

        logger.info(f"Testing {path.name}...")
        try:
            with open(path.parent / MODEL_INFO_JSON_NAME) as f:
                info = json.load(f)
                info = (
                    FixedModelInfo(**info)
                    if "quantization_profile" not in info
                    else QuantFixedModelInfo(**info)
                )

            tokenizer = AutoTokenizer.from_pretrained(info.hg_model_path)
            res = {
                "model": path.name,
                **run_vector_analysis(path, tokenizer, TEST_WORDS, info),
            }

            # Throughput
            # Need to create session to get supported inputs for throughput too
            temp_session = ort.InferenceSession(
                str(path), providers=["CPUExecutionProvider"]
            )
            model_inputs = {i.name for i in temp_session.get_inputs()}

            encoded_thr = tokenizer(
                ["npu"] * info.batch_size,
                padding="max_length",
                max_length=info.seq_len,
                return_tensors="np",
            )
            inputs = {
                k: v.astype(np.int64) for k, v in encoded_thr.items() if k in model_inputs
            }

            for prov in PROVIDERS:
                try:
                    _, thr = run_throughput_benchmark(
                        path,
                        prov,
                        inputs,
                        info.batch_size,
                        n=n_iters if "Vitis" in prov else 20,
                    )
                    res[prov[:3].lower() + "_thr"] = thr
                except Exception as e:
                    logger.error(f"Error {path.name}: {e}")
                    res[prov[:3].lower() + "_thr"] = 0
            results.append(res)
        except Exception as e:
            logger.error(f"Error {path.name}: {e}")

    if results:
        # Dynamic column width for model name
        max_name_len = max(len(r["model"]) for r in results)
        max_name_len = min(max(max_name_len, 10), 50)  # Clamp between 10 and 50

        header = f"\n{'Model':<{max_name_len}} | {'NPU/s':>8} | {'CPU/s':>8} | {'CLS Var':>10} | {'Mean Var':>10}"
        sep = "-" * len(header)
        logger.info(f"\n{sep}\n{header}\n{sep}")

        for r in results:
            # Truncate if still too long
            name = (
                (r["model"][: max_name_len - 3] + "...")
                if len(r["model"]) > max_name_len
                else r["model"]
            )
            logger.info(
                f"{name:<{max_name_len}} | {r.get('vit_thr', 0):>8.1f} | {r.get('cpu_thr', 0):>8.1f} | {r['cls_var']:>10.6f} | {r['mean_var']:>10.6f}"
            )
        logger.info(sep)


if __name__ == "__main__":
    pass
