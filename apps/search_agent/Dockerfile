# syntax=docker/dockerfile:1.7

ARG UV_VERSION=0.12.9

FROM ghcr.io/astral-sh/uv:${UV_VERSION}-python3.14-trixie-slim AS base


FROM base AS artifacts

WORKDIR /bundle
COPY search/deep_learn/models/ ./model/

ARG SEARCH_MODEL_REPOSITORY=""
ARG SEARCH_MODEL_REVISION=""
ARG HUGGINGFACE_HUB_VERSION=1.30.0

# CI resolves one immutable model revision; local builds use ignored weights on disk.
RUN --mount=type=secret,id=hf_token \
    set -eu; \
    if [ -n "$SEARCH_MODEL_REPOSITORY" ]; then \
        test -n "$SEARCH_MODEL_REVISION"; \
        if [ -s /run/secrets/hf_token ]; then \
            export HF_TOKEN="$(cat /run/secrets/hf_token)"; \
        fi; \
        uvx --from "huggingface-hub==$HUGGINGFACE_HUB_VERSION" hf download \
            "$SEARCH_MODEL_REPOSITORY" \
            best_CostApproximation.pt \
            --revision "$SEARCH_MODEL_REVISION" \
            --local-dir /bundle/model; \
    fi; \
    test -s model/best_CostApproximation.pt


FROM base AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app/search_agent

# Install only locked runtime dependencies and keep uv's download cache out of the image.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

ENV PATH="/app/search_agent/.venv/bin:$PATH" \
    PYTHONPATH=/app

WORKDIR /app
COPY --chown=10001:10001 . ./search_agent
COPY --from=artifacts --chown=10001:10001 /bundle/model/best_CostApproximation.pt \
    ./search_agent/search/deep_learn/models/best_CostApproximation.pt

EXPOSE 8000

WORKDIR /app/search_agent
USER 10001

CMD ["python", "-m", "search_agent.main", "serve"]
