"""Shared contracts for dictionary graph search implementations."""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, ConfigDict

from search_agent.db import SelectableLexicalKey, WinkPosTag


class EdgeConstraints(BaseModel):
    """Define the dictionary edges available to one search.

    Attributes:
        lemmatized: Whether traversals use lemma links instead of surface words.
        available_lexical_fields: Lexical relations available to the search.
        available_pos: Target part-of-speech buckets available to the search.
    """

    model_config = ConfigDict(frozen=True)

    lemmatized: bool = True
    available_lexical_fields: frozenset[SelectableLexicalKey] = frozenset(
        SelectableLexicalKey
    )
    available_pos: frozenset[WinkPosTag] = frozenset(WinkPosTag)

    @property
    def link_field(self) -> str:
        """Return the rich-token field selected by the lemmatization rule."""
        return "l" if self.lemmatized else "w"


class RegularSearchResult(BaseModel):
    """A complete directed path from the requested start to target word."""

    start_path: tuple[str, ...]


class CollideSearchResult(RegularSearchResult):
    """Two complete directed paths ending at the same meeting word."""

    target_path: tuple[str, ...]


class SearchAlgorithm(Protocol):
    """Provide regular and collide search over a constrained word graph."""

    async def search_regular(
        self,
        start: str,
        target: str,
        edge_constraints: EdgeConstraints = EdgeConstraints(),
    ) -> RegularSearchResult | None:
        """Return a directed start-to-target path when one exists."""
        ...

    async def search_collide(
        self,
        start: str,
        target: str,
        edge_constraints: EdgeConstraints = EdgeConstraints(),
    ) -> CollideSearchResult | None:
        """Return two outgoing paths that meet when a collision exists."""
        ...
