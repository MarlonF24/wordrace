from sqlalchemy import (
    SMALLINT,
    TEXT,
    Integer,
    event,
    Connection,
    text,
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
)
from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped
from sqlalchemy.ext.asyncio import AsyncAttrs
from pgvector.sqlalchemy import Vector
from pgvector.asyncpg import register_vector

from search_agent.db.dictionary import Words
import numpy as np

ML_SCHEMA_NAME = "ml"


class MLBase(DeclarativeBase, AsyncAttrs):
    __table_args__ = {"schema": ML_SCHEMA_NAME}


EMBEDDINGS_INDEX_NAME = "idx_embeddings_embedding"

EMBEDDING_DIMENSION = 384


class Embeddings(MLBase):
    __tablename__ = "embeddings"
    __table_args__ = (
        ForeignKeyConstraint(["word"], [Words.word], name="embeddings_word_fkey"),
        CheckConstraint(
            "word !~ '\\s'", name="no_space_in_term"
        ),  # only single token words
        Index(
            EMBEDDINGS_INDEX_NAME,
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index("idx_graph_id", "graph_id"),
        {"schema": ML_SCHEMA_NAME},
    )

    word: Mapped[str] = mapped_column(TEXT, primary_key=True)
    graph_id: Mapped[int] = mapped_column(
        Integer, nullable=True
    )  # store id translation for graph algorithms
    embedding: Mapped[np.ndarray] = mapped_column(Vector(EMBEDDING_DIMENSION))


class Graph(MLBase):
    __tablename__ = "graph"
    __table_args__ = {"schema": ML_SCHEMA_NAME}

    source_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lexical_field: Mapped[str] = mapped_column(SMALLINT, primary_key=True)
    lemmatized: Mapped[bool] = mapped_column(nullable=False, primary_key=True)


@event.listens_for(MLBase.metadata, "before_create")
def create_vector_extension(target, connection: Connection, **kw):
    connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {ML_SCHEMA_NAME};"))
    connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))


def driver_setup(connection):
    connection.run_async(register_vector)
