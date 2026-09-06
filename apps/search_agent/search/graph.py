"""Export the database dictionary graph to igraph-compatible parquet files."""

from pathlib import Path

import igraph as ig
import polars as pl
from sqlalchemy import func, select

from search_agent.ENV import ENV
from search_agent.db.dictionary import Dictionary, DummyTable
from search_agent.db.ML.schema import Embeddings
from search_agent.search.igraph import (
    GRAPH_DATA_DIR,
    GRAPH_EDGES_FILENAME,
    GRAPH_NODES_FILENAME,
)


def export_ids(out_dir: Path) -> None:
    """Export the stable word-to-vertex mapping used by every edge graph.

    Args:
        out_dir: Directory that receives the node parquet file.
    """
    stmt = select(
        (func.row_number().over(order_by=Embeddings.word) - 1).label("node_id"),
        Embeddings.word,
    )

    compiled_stmt = stmt.compile(compile_kwargs={"literal_binds": True})
    print("Exporting nodes...")
    nodes_df = pl.read_database_uri(query=str(compiled_stmt), uri=ENV.database_url(""))
    nodes_df.write_parquet(out_dir / GRAPH_NODES_FILENAME, compression="zstd")


def export_edges(out_dir: Path) -> None:
    """Export traversable dictionary edges and their stable filter dimensions.

    Args:
        out_dir: Directory that receives the edge parquet file.
    """
    embeddings_table = Embeddings.__table__
    dictionary_table = Dictionary.__table__
    embeddings_word_column = Embeddings.word.name
    dictionary_word_column = Dictionary.word.name
    all_links_column = Dictionary.all_links.name
    lexical_key_column = DummyTable.selectable_lexical_keys_dummy
    enum_type = f"{lexical_key_column.type.schema}.{lexical_key_column.type.name}"

    # The generated JSONB is rooted by word/lemma mode, then relation and POS.
    # Normalize each target before joining it to the canonical vertex set so
    # export and database traversal expose the same edges.
    edges_query = f"""
    WITH nodes AS (
        SELECT
            (ROW_NUMBER() OVER (ORDER BY {embeddings_word_column}) - 1)::INT AS id,
            {embeddings_word_column} AS word
        FROM {embeddings_table.fullname}
    ),
    enum_map AS (
        SELECT value::text AS name, (idx - 1)::SMALLINT AS id
        FROM unnest(enum_range(NULL::{enum_type})) WITH ORDINALITY AS enums(value, idx)
    )
    SELECT
        n1.id AS source_id,
        n2.id AS target_id,
        em.id AS edge_type,
        (link_mode.link_field = 'l')::INT::SMALLINT AS lemmatized,
        pos_links.pos AS target_pos
    FROM {dictionary_table.fullname} AS d
    JOIN nodes n1 ON n1.word = d.{dictionary_word_column}
    CROSS JOIN LATERAL jsonb_each(d.{all_links_column})
        AS link_mode(link_field, lexical_fields)
    CROSS JOIN LATERAL jsonb_each(link_mode.lexical_fields) AS links(rel, pos_values)
    JOIN enum_map em ON em.name = links.rel
    CROSS JOIN LATERAL jsonb_each(links.pos_values) AS pos_links(pos, targets)
    CROSS JOIN LATERAL jsonb_array_elements_text(pos_links.targets)
        AS target_words(word)
    JOIN nodes n2 ON n2.word = lower(target_words.word)
    """
    print("Exporting edges...")
    edges_df = pl.read_database_uri(query=edges_query, uri=ENV.database_url(driver=""))
    edges_df.write_parquet(out_dir / GRAPH_EDGES_FILENAME, compression="zstd")


def export_graph(output_dir: Path) -> None:
    """Export node and edge parquet files as one consistent graph snapshot."""
    output_dir.mkdir(exist_ok=True, parents=True)
    export_ids(output_dir)
    export_edges(output_dir)


def preview_graph_data(data_dir: Path, num_rows: int = 10) -> None:
    """Print a bounded preview of exported node and edge rows."""
    nodes_path = data_dir / GRAPH_NODES_FILENAME
    edges_path = data_dir / GRAPH_EDGES_FILENAME

    print("NODES PREVIEW (ID -> Word)")
    if nodes_path.exists():
        # Lazy scanning reads only the requested preview rows.
        nodes_df = pl.scan_parquet(nodes_path)

        print(nodes_df.head(num_rows).collect())
    else:
        print(f"Nodes file not found at {nodes_path}")

    print("\nEDGES PREVIEW (Connections)")
    if edges_path.exists():
        edges_df = pl.scan_parquet(edges_path)
        print(edges_df.head(num_rows).collect())
    else:
        print(f"Edges file not found at {edges_path}")


def export_graph_for_gephi(output_dir: Path) -> None:
    """Export a small two-hop neighborhood for optional Gephi inspection."""
    # Build the complete directed graph from the current parquet snapshot.
    nodes_df = pl.read_parquet(output_dir / GRAPH_NODES_FILENAME)
    edges_df = pl.read_parquet(output_dir / GRAPH_EDGES_FILENAME)

    g = ig.Graph(n=len(nodes_df), directed=True)
    g.add_edges(edges_df.select(["source_id", "target_id"]).to_numpy())
    g.vs["name"] = nodes_df["word"].to_numpy()

    # Keep visualization output bounded to two outgoing hops from one familiar word.
    seed_word = "apple"
    seed_id = nodes_df.filter(pl.col("word") == seed_word)["node_id"][0]
    neighborhood_ids = g.neighborhood(vertices=seed_id, order=2, mode="out")
    subgraph = g.subgraph(neighborhood_ids)
    subgraph.write_graphml(str(output_dir / "apple_neighborhood.graphml"))
    print(f"Exported neighborhood with {subgraph.vcount()} nodes for visualization.")


if __name__ == "__main__":
    # export_graph(GRAPH_DATA_DIR)
    preview_graph_data(GRAPH_DATA_DIR)
