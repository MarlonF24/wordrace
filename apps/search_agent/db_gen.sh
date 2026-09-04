#!/usr/bin/env bash

set -euo pipefail
set -a
source .env
set +a

mkdir -p db

database_url="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

uv run sqlacodegen --generator declarative "$database_url" --schemas="$DATA_SCHEMA" --outfile="db/$DATA_SCHEMA.py"
uv run sqlacodegen --generator declarative "$database_url" --schemas="$DICT_SCHEMA" --outfile="db/$DICT_SCHEMA.py"
