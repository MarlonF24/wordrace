"""Exact word-graph search over the exported igraph parquet index."""

from __future__ import annotations

import warnings
from collections.abc import Sequence
from pathlib import Path

import igraph as ig
from jaxtyping import Float
import numpy as np
import polars as pl

from search_agent.db import SelectableLexicalKey, WinkPosTag
from search_agent.logger import logger
from search_agent.search.contracts import (
    CollideSearchResult,
    EdgeConstraints,
    RegularSearchResult,
)


GRAPH_DATA_DIR = Path(__file__).parent / "graph"
GRAPH_NODES_FILENAME = "wiktionary_nodes.parquet"
GRAPH_EDGES_FILENAME = "wiktionary_edges.parquet"
REQUIRED_NODE_COLUMNS = frozenset({"node_id", "word"})
REQUIRED_EDGE_COLUMNS = frozenset(
    {"source_id", "target_id", "edge_type", "lemmatized", "target_pos"}
)


class IgraphSearch:
    """Search the complete exported word graph with exact igraph operations."""

    MAX_FILTERED_GRAPH_CACHE_SIZE = 4

    _graphs: dict[bool, ig.Graph] = {}
    _filtered_graphs: dict[
        tuple[
            bool,
            frozenset[SelectableLexicalKey],
            frozenset[WinkPosTag],
        ],
        ig.Graph,
    ] = {}
    _word_to_id: dict[str, int] = {}
    _id_to_word: dict[int, str] = {}
    _artifacts_validated = False
    _lexical_field_to_id = {
        lexical_field: index for index, lexical_field in enumerate(SelectableLexicalKey)
    }

    def _load_graph(self, lemmatized: bool) -> None:
        """Load one raw-word or lemma graph from the exported parquet files."""
        nodes_path = GRAPH_DATA_DIR / GRAPH_NODES_FILENAME
        edges_path = GRAPH_DATA_DIR / GRAPH_EDGES_FILENAME
        if not nodes_path.exists() or not edges_path.exists():
            logger.warning(
                "Graph data not found at %s; IgraphSearch is unavailable.", GRAPH_DATA_DIR
            )
            return

        logger.info("Loading IgraphSearch graph with lemmatized=%s.", lemmatized)
        edges = pl.read_parquet(edges_path)
        search_type = type(self)

        # Node IDs are shared by both edge modes and only need to be loaded once.
        if not search_type._word_to_id:
            nodes = pl.read_parquet(nodes_path)
            self._validate_columns(nodes, REQUIRED_NODE_COLUMNS, nodes_path)
            search_type._word_to_id = dict(zip(nodes["word"], nodes["node_id"]))
            search_type._id_to_word = dict(zip(nodes["node_id"], nodes["word"]))

        if not search_type._artifacts_validated:
            self._validate_columns(edges, REQUIRED_EDGE_COLUMNS, edges_path)
            self._validate_target_pos(edges, edges_path)
            search_type._artifacts_validated = True

        edges = edges.filter(pl.col("lemmatized") == (1 if lemmatized else 0))
        graph = ig.Graph(n=len(search_type._word_to_id), directed=True)
        graph.add_edges(edges.select(["source_id", "target_id"]).to_numpy())
        graph.es["edge_type"] = edges["edge_type"].to_numpy().astype(np.int16)
        graph.es["target_pos"] = edges["target_pos"].to_list()
        search_type._graphs[lemmatized] = graph
        logger.info(
            "Graph loaded with %d nodes and %d edges.", graph.vcount(), graph.ecount()
        )

    @staticmethod
    def _validate_columns(
        frame: pl.DataFrame,
        required_columns: frozenset[str],
        path: Path,
    ) -> None:
        """Reject graph artifacts missing columns required by exact search."""
        missing_columns = required_columns.difference(frame.columns)
        if missing_columns:
            raise ValueError(
                f"Graph artifact {path} is missing required columns: "
                f"{sorted(missing_columns)}."
            )

    @staticmethod
    def _validate_target_pos(edges: pl.DataFrame, path: Path) -> None:
        """Reject stale graph edges whose target POS is null or not Wink POS."""
        target_pos = edges["target_pos"]
        if target_pos.null_count():
            raise ValueError(f"Graph artifact {path} contains null target_pos values.")

        unknown_pos = set(target_pos.unique()).difference(pos.value for pos in WinkPosTag)
        if unknown_pos:
            raise ValueError(
                f"Graph artifact {path} contains unknown target_pos values: "
                f"{sorted(unknown_pos)}."
            )

    def _get_graph(self, edge_constraints: EdgeConstraints) -> ig.Graph | None:
        """Return the base graph or a cached graph filtered by stable constraints."""
        search_type = type(self)
        if edge_constraints.lemmatized not in search_type._graphs:
            self._load_graph(edge_constraints.lemmatized)

        graph = search_type._graphs.get(edge_constraints.lemmatized)
        if graph is None:
            return None

        # Complete default sets select the base graph without allocating a
        # filtered copy or a redundant cache entry.
        if edge_constraints.available_lexical_fields == frozenset(
            SelectableLexicalKey
        ) and edge_constraints.available_pos == frozenset(WinkPosTag):
            return graph
        if (
            not edge_constraints.available_lexical_fields
            or not edge_constraints.available_pos
        ):
            return None

        cache_key = (
            edge_constraints.lemmatized,
            edge_constraints.available_lexical_fields,
            edge_constraints.available_pos,
        )
        if cache_key in search_type._filtered_graphs:
            cached_graph = search_type._filtered_graphs.pop(cache_key)
            search_type._filtered_graphs[cache_key] = cached_graph
            return cached_graph

        if len(search_type._filtered_graphs) >= self.MAX_FILTERED_GRAPH_CACHE_SIZE:
            del search_type._filtered_graphs[next(iter(search_type._filtered_graphs))]

        allowed_edge_types = {
            self._lexical_field_to_id[lexical_field]
            for lexical_field in edge_constraints.available_lexical_fields
        }
        allowed_pos = {pos.value for pos in edge_constraints.available_pos}
        selected_edges = graph.es.select(edge_type_in=allowed_edge_types).select(
            target_pos_in=allowed_pos
        )

        logger.info(
            "Creating filtered graph with lemmatized=%s, lexical fields=%s, POS=%s.",
            edge_constraints.lemmatized,
            {field.value for field in edge_constraints.available_lexical_fields},
            allowed_pos,
        )
        filtered_graph = graph.subgraph_edges(
            selected_edges.indices,
            delete_vertices=False,
        )
        search_type._filtered_graphs[cache_key] = filtered_graph
        return filtered_graph

    async def search_regular(
        self,
        start: str,
        target: str,
        edge_constraints: EdgeConstraints = EdgeConstraints(),
    ) -> RegularSearchResult | None:
        """Return the exact directed shortest path between two words."""
        start = start.lower()
        target = target.lower()
        if start == target:
            return RegularSearchResult(start_path=(start,))

        graph = self._get_graph(edge_constraints)
        start_id = self._word_to_id.get(start)
        target_id = self._word_to_id.get(target)
        if graph is None or start_id is None or target_id is None:
            return None

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            paths = graph.get_shortest_paths(
                start_id,
                to=target_id,
                mode="out",
                output="vpath",
            )
        if not paths or not paths[0]:
            return None

        return RegularSearchResult(
            start_path=tuple(self._id_to_word[word_id] for word_id in paths[0])
        )

    async def search_collide(
        self,
        start: str,
        target: str,
        edge_constraints: EdgeConstraints = EdgeConstraints(),
    ) -> CollideSearchResult | None:
        """Return the shortest pair of outgoing paths that meet at one word."""
        start = start.lower()
        target = target.lower()
        if start == target:
            return CollideSearchResult(start_path=(start,), target_path=(target,))

        graph = self._get_graph(edge_constraints)
        start_id = self._word_to_id.get(start)
        target_id = self._word_to_id.get(target)
        if graph is None or start_id is None or target_id is None:
            return None

        # Both lanes follow outgoing edges, so the best meeting vertex minimizes
        # the sum of independently directed distances from the two endpoints.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            distances = np.asarray(
                graph.distances(source=[start_id, target_id], mode="out"),
                dtype=np.float32,
            )

        combined_distances = distances[0] + distances[1]
        reachable_vertices = np.flatnonzero(np.isfinite(combined_distances))
        if reachable_vertices.size == 0:
            return None

        meeting_id = int(
            reachable_vertices[np.argmin(combined_distances[reachable_vertices])]
        )
        start_path_ids = graph.get_shortest_paths(
            start_id,
            to=meeting_id,
            mode="out",
            output="vpath",
        )[0]
        target_path_ids = graph.get_shortest_paths(
            target_id,
            to=meeting_id,
            mode="out",
            output="vpath",
        )[0]
        return CollideSearchResult(
            start_path=tuple(self._id_to_word[word_id] for word_id in start_path_ids),
            target_path=tuple(self._id_to_word[word_id] for word_id in target_path_ids),
        )

    def out_neighbors(
        self,
        word: str,
        edge_constraints: EdgeConstraints = EdgeConstraints(),
    ) -> tuple[str, ...]:
        """Return legal outgoing neighbors for one word from the indexed graph."""
        word = word.lower()
        graph = self._get_graph(edge_constraints)
        word_id = self._word_to_id.get(word)
        if graph is None or word_id is None:
            return ()
        return tuple(
            self._id_to_word[neighbor_id]
            for neighbor_id in graph.neighbors(word_id, mode="out")
        )

    def distance_matrix(
        self,
        start_words: Sequence[str],
        target_words: Sequence[str],
        edge_constraints: EdgeConstraints = EdgeConstraints(),
    ) -> Float[np.ndarray, "n_starts n_targets"]:
        """Return exact directed link counts for every requested word pair.

        Missing words and unreachable pairs retain ``numpy.inf``. Identical
        words receive distance zero even when graph artifacts are unavailable.
        """
        distances = np.full(
            (len(start_words), len(target_words)),
            np.inf,
            dtype=np.float32,
        )
        if not start_words or not target_words:
            return distances

        graph = self._get_graph(edge_constraints)
        if graph is None:
            for start_index, start in enumerate(start_words):
                for target_index, target in enumerate(target_words):
                    if start.lower() == target.lower():
                        distances[start_index, target_index] = 0.0
            return distances

        source_pairs = [
            (index, word_id)
            for index, word in enumerate(start_words)
            if (word_id := self._word_to_id.get(word.lower())) is not None
        ]
        target_pairs = [
            (index, word_id)
            for index, word in enumerate(target_words)
            if (word_id := self._word_to_id.get(word.lower())) is not None
        ]
        if not source_pairs or not target_pairs:
            return distances

        source_indices, source_ids = zip(*source_pairs)
        target_indices, target_ids = zip(*target_pairs)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            valid_distances = graph.distances(
                source=source_ids,
                target=target_ids,
                mode="out",
            )

        distances[np.ix_(source_indices, target_indices)] = np.asarray(
            valid_distances,
            dtype=np.float32,
        )
        return distances
