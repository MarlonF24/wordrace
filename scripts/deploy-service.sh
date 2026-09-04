#!/usr/bin/env bash
set -euo pipefail

readonly SERVICE_NAME=${1:?Usage: deploy-service.sh SERVICE}
readonly RUNTIME_ENV_FILE=.env.production


if [[ ! -f "$RUNTIME_ENV_FILE" ]]; then
    echo "Missing $(pwd)/$RUNTIME_ENV_FILE; provision it from .env.example first." >&2
    exit 1
fi

case "$SERVICE_NAME" in
    nextjs_app | search_agent_app) ;;
    *)
        echo "Unsupported service: $SERVICE_NAME" >&2
        exit 1
        ;;
esac

compose=(docker compose --env-file "$RUNTIME_ENV_FILE" --file docker-compose.yml)

# Keep shared infrastructure alive while each application updates independently.
"${compose[@]}" up -d --wait db
"${compose[@]}" pull "$SERVICE_NAME"

if [[ "$SERVICE_NAME" == "nextjs_app" ]]; then
    "${compose[@]}" run --rm --no-deps nextjs_migrate
    "${compose[@]}" up -d --wait --wait-timeout 120 --no-deps nextjs_app
    "${compose[@]}" up -d --no-deps caddy
else
    "${compose[@]}" run --rm --no-deps search_agent_migrate
    "${compose[@]}" up -d --wait --wait-timeout 120 --no-deps search_agent_app
fi

"${compose[@]}" ps
docker image prune -f
