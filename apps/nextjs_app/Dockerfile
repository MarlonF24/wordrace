ARG BUN_VERSION=1.3.9

FROM oven/bun:${BUN_VERSION}-alpine AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app


FROM base AS dependencies

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile


FROM base AS production-dependencies

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production


FROM base AS builder

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ARG DATA_SCHEMA=public
ARG DICT_SCHEMA=dictionary
ENV DATA_SCHEMA=${DATA_SCHEMA} \
    DICT_SCHEMA=${DICT_SCHEMA}

# Bundle the migration job alongside the application server.
RUN bun run build
RUN bun build ./src/lib/db/migrate.ts \
    --outfile ./dist/migrate.mjs \
    --target bun \
    --format esm \
    --external tydantic-settings


FROM base AS runtime

ENV NODE_ENV=production \
    MIGRATION_SCRIPT_PATH=/app/dist/migrate.mjs

ARG DATA_SCHEMA=public
ARG DICT_SCHEMA=dictionary
ENV DATA_SCHEMA=${DATA_SCHEMA} \
    DICT_SCHEMA=${DICT_SCHEMA}

# Runtime dependencies support the server and migration job without build tooling.
COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/.next ./.next
COPY --from=builder --chown=bun:bun /app/public ./public
COPY --from=builder --chown=bun:bun /app/dist ./dist
COPY --from=builder --chown=bun:bun /app/migrations ./migrations
COPY --from=builder --chown=bun:bun /app/package.json ./package.json

USER bun
EXPOSE 3000

CMD ["bun", "run", "start"]
