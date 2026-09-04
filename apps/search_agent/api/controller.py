"""FastAPI boundary for regular and collide word-graph search."""

from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from search_agent.logger import logger
from search_agent.search import (
    AStarScorer,
    CollideSearchResult,
    EdgeConstraints,
    GeneralizedShortestPathSearch,
    LearnedCostHeuristic,
    RegularSearchResult,
    SearchAlgorithm,
)


regular_search_algorithm: SearchAlgorithm = (
    GeneralizedShortestPathSearch.best_first_search(
        scorer=AStarScorer(
            heuristic=LearnedCostHeuristic(device="cpu"),
        ),
    )
)
collide_search_algorithm: SearchAlgorithm = (
    GeneralizedShortestPathSearch.best_first_search(
        scorer=AStarScorer(
            heuristic=LearnedCostHeuristic(device="cpu"),
        ),
    )
)

app = FastAPI()


class HealthResponse(BaseModel):
    """Report that the API process is ready to receive requests."""

    status: Literal["ok"] = "ok"


class SearchRequest(BaseModel):
    """Specify two endpoint words and the graph edges available between them."""

    start: str
    target: str
    constraints: EdgeConstraints


@app.get("/health", include_in_schema=False)
def health() -> HealthResponse:
    """Return process readiness for container health checks."""
    return HealthResponse()


@app.post(
    "/search",
    operation_id="search_regular",
    response_model=RegularSearchResult,
    responses={404: {"description": "No legal regular route was found."}},
)
async def search(request: SearchRequest) -> RegularSearchResult:
    """Return a regular route or HTTP 404 when no legal route is found."""
    result = await regular_search_algorithm.search_regular(
        request.start,
        request.target,
        edge_constraints=request.constraints,
    )
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No route found from '{request.start}' to '{request.target}'.",
        )

    logger.info(
        "Regular search completed: %s -> %s (%s).",
        request.start,
        request.target,
        result.start_path,
    )
    return result


@app.post(
    "/collide-search",
    operation_id="search_collide",
    response_model=CollideSearchResult,
    responses={404: {"description": "No legal collide route was found."}},
)
async def collide_search(request: SearchRequest) -> CollideSearchResult:
    """Return two meeting routes or HTTP 404 when no collision is found."""
    result = await collide_search_algorithm.search_collide(
        request.start,
        request.target,
        edge_constraints=request.constraints,
    )
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No collision route found from '{request.start}' and '{request.target}'."
            ),
        )

    logger.info(
        "Collide search completed: %s and %s (%s, %s).",
        request.start,
        request.target,
        result.start_path,
        result.target_path,
    )
    return result
