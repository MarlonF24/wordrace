"""Seed database embeddings by streaming ONNX inference results into PostgreSQL."""

import asyncio, json, numpy as np, onnxruntime as ort, multiprocessing as mp
from pathlib import Path
from transformers import AutoTokenizer
from typing import Literal
from sqlalchemy.future import select
from sqlalchemy import text
from pgvector.asyncpg import register_vector
import io

from search_agent.db.db import ASYNC_SESSION_MAKER
from search_agent.db.dictionary import Words
from search_agent.db.ML.schema import Embeddings, EMBEDDINGS_INDEX_NAME
from search_agent.db.ML.npu.quantize_model import QuantFixedModelInfo, MODEL_INFO_JSON_NAME

CONFIG_PATH = Path(r"C:\Program Files\RyzenAI\1.7.1\voe-4.0-win_amd64\vaip_config.json")

PoolingMethod = Literal["mean", "cls"]
Device = Literal["CPU", "NPU"]

# We use a larger chunk size to minimize IPC overhead
INFERENCE_CHUNK = 20_000
LOG_EVERY = 50  # batches between progress prints

# ---------------------------------------------------------------------------
# Worker Process
# ---------------------------------------------------------------------------


def _inference_worker(
    model_path: Path,
    pooling: PoolingMethod,
    device: Device,
    input_ids: np.ndarray,
    attention_mask: np.ndarray,
    words: list[str],
    result_queue: mp.Queue,
):
    """
    Subprocess for pure inference. Bypasses the GIL of the main process.
    """
    print(f"  [Worker] Initialising {device} session...")
    with open(model_path.parent / MODEL_INFO_JSON_NAME) as f:
        info = QuantFixedModelInfo(**json.load(f))

    session = ort.InferenceSession(
        str(model_path),
        sess_options=ort.SessionOptions(),
        providers=["VitisAIExecutionProvider"]
        if device == "NPU"
        else ["CPUExecutionProvider"],
        provider_options=[
            {
                "config_file": str(CONFIG_PATH),
                "cache_dir": str(model_path.parent.parent),
                "cache_key": str(model_path.parent),
                "enable_cache_file_io_in_mem": "0",
            }
        ],
    )

    BS = info.batch_size
    n = input_ids.shape[0]
    model_input_names = {inp.name for inp in session.get_inputs()}

    for i in range(0, n, INFERENCE_CHUNK):
        chunk_end = min(i + INFERENCE_CHUNK, n)
        subset_ids = input_ids[i:chunk_end]
        subset_mask = attention_mask[i:chunk_end]
        subset_words = words[i:chunk_end]

        chunk_vecs: list[np.ndarray] = []

        for j in range(0, subset_ids.shape[0], BS):
            ids = subset_ids[j : j + BS]
            mask = subset_mask[j : j + BS]
            actual = ids.shape[0]

            if actual < BS:
                ids = np.pad(ids, ((0, BS - actual), (0, 0)))
                mask = np.pad(mask, ((0, BS - actual), (0, 0)))

            feed = {}
            if "input_ids" in model_input_names:
                feed["input_ids"] = ids
            if "attention_mask" in model_input_names:
                feed["attention_mask"] = mask

            out = session.run(None, feed)[0]

            if pooling == "cls":
                vecs = out[:, 0, :]
            else:
                mask_f = np.expand_dims(mask, -1).astype(np.float32)
                vecs = (out * mask_f).sum(1) / mask_f.sum(1).clip(1e-9)

            chunk_vecs.append(vecs[:actual].astype(np.float32))

        # Normalise and package the whole chunk at once
        vecs_all = np.concatenate(chunk_vecs, axis=0)
        norms = np.linalg.norm(vecs_all, axis=1, keepdims=True).clip(1e-9)
        normalised = (vecs_all / norms).astype(np.float32)

        # Put records in queue
        result_queue.put(list(zip(subset_words, normalised)))

    result_queue.put(None)  # Sentinel


# ---------------------------------------------------------------------------
# DB insert — using efficient text-based COPY (similar to seed.ts pipeline)
# ---------------------------------------------------------------------------


def _to_csv_row(word: str, vector: np.ndarray) -> bytes:
    """Serialize one word/vector pair for PostgreSQL COPY.

    Args:
        word: Dictionary word to insert.
        vector: Normalized embedding vector in pgvector order.

    Returns:
        UTF-8 encoded tab-delimited row with the vector in pgvector text form.
    """
    # vector format [0.1, 0.2, ...] for pgvector
    vec_str = "[" + ",".join(map(str, vector.tolist())) + "]"
    return f'"{word.replace('"', '""')}"\t{vec_str}\n'.encode("utf-8")


async def _copy_insert_fast(pg_conn, records: list, chunk_idx: int) -> None:
    """Bulk insert one chunk of embedding records through PostgreSQL COPY.

    Args:
        pg_conn: Raw asyncpg connection registered for pgvector values.
        records: Iterable of ``(word, vector)`` pairs produced by the worker.
        chunk_idx: Monotonic chunk number used only for progress output.
    """
    # Convert records to a bytes-buffer for fastest input
    buf = io.BytesIO()
    for word, vec in records:
        buf.write(_to_csv_row(word, vec))
    buf.seek(0)

    await pg_conn.copy_to_table(
        Embeddings.__tablename__,
        schema_name=Embeddings.__table__.schema,
        source=buf,
        columns=["word", "embedding"],
        format="csv",
        delimiter="\t",
        quote='"',
    )
    print(f"  [DB]   chunk {chunk_idx:>3}  ({len(records):,} rows) ✓")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def seed_embeddings(
    model_path: Path,
    pooling: PoolingMethod = "mean",
    truncate: bool = True,
    drop_index_during_insert: bool = True,
    device: Device = "NPU",
) -> None:
    """
    Multiprocessing pipeline for blazing fast seeding.
    """

    # ── 1. Fetch words ────────────────────────────────────────────────────
    async with ASYNC_SESSION_MAKER() as session:
        stmt = select(Words.word).where(~Words.word.like("% %"))

        if truncate:
            await session.execute(
                text(
                    f"TRUNCATE TABLE {Embeddings.__table__.schema}.{Embeddings.__tablename__}"
                )
            )
            await session.commit()
        else:
            stmt = stmt.where(
                ~select(Embeddings.word).where(Embeddings.word == Words.word).exists()
            )

        result = await session.execute(stmt)
        words: list[str] = [r[0] for r in result.all()]

    total = len(words)
    if total == 0:
        print("Nothing to embed.")
        return
    print(f"Words to embed: {total:,}")

    # ── 2. Tokenize (Main Process) ────────────────────────────────────────
    with open(model_path.parent / MODEL_INFO_JSON_NAME) as f:
        info = QuantFixedModelInfo(**json.load(f))
    tokenizer = AutoTokenizer.from_pretrained(info.hg_model_path)

    print(f"Tokenizing {total:,} words...")
    enc = tokenizer(
        words,
        padding="max_length",
        max_length=info.seq_len,
        truncation=True,
        return_tensors="np",
    )
    all_ids = enc["input_ids"].astype(np.int64)
    all_mask = enc["attention_mask"].astype(np.int64)

    # ── 3. Start Inference Worker (Process) ───────────────────────────────
    result_queue = mp.Queue(maxsize=4)  # Buffer up to 4 large chunks
    worker = mp.Process(
        target=_inference_worker,
        args=(model_path, pooling, device, all_ids, all_mask, words, result_queue),
    )
    worker.start()

    # ── 4. Main Event Loop Handles streaming results to DB ────────────────
    async with ASYNC_SESSION_MAKER() as session:
        conn = await session.connection()
        raw = await conn.get_raw_connection()
        pg_conn = raw._connection
        await register_vector(pg_conn)

        schema = Embeddings.__table__.schema
        table = Embeddings.__tablename__

        if drop_index_during_insert:
            print(
                f"  [DB] Dropping index {EMBEDDINGS_INDEX_NAME} for high-speed bulk load..."
            )
            await pg_conn.execute(
                f"DROP INDEX IF EXISTS {schema}.{EMBEDDINGS_INDEX_NAME}"
            )

        chunk_idx = 0
        loop = asyncio.get_event_loop()

        print(f"Streaming from worker to DB...\n")

        while True:
            # We use run_in_executor to avoid blocking the event loop on queue.get()
            records = await loop.run_in_executor(None, result_queue.get)

            if records is None:  # Sentinel
                break

            await _copy_insert_fast(pg_conn, records, chunk_idx)
            chunk_idx += 1

        await session.commit()

        if drop_index_during_insert:
            print(
                f"\n  [DB] Rebuilding HNSW index {EMBEDDINGS_INDEX_NAME} (this might take a while)..."
            )
            # Pull parameters directly from our schema definition if possible,
            # or keep them matched here. m=16, ef_construction=64.
            await pg_conn.execute(f"""
                CREATE INDEX {EMBEDDINGS_INDEX_NAME} ON {schema}.{table} 
                USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64)
            """)
            print("  [DB] Index rebuilt ✓")

    worker.join()
    print(f"\nSeeding complete ✓  ({total:,} embeddings)")
    print(f"\nSeeding complete ✓  ({total:,} embeddings)")


if __name__ == "__main__":
    pass
