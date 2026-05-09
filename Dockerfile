ARG DATA_SCHEMA=public
ARG DICT_SCHEMA=dictionary

# 1. THE BASE (Tiny Linux with Bun installed)
FROM oven/bun:canary-alpine AS base
WORKDIR /app

# 2. THE DEPENDENCIES STAGE
# We do this separately so that if you change your code but NOT your packages, 
# Docker skips this step and builds instantly.
FROM base AS deps
COPY package.json bun.lock ./

# Install production dependencies + the optional dependencies needed for our generator scripts
RUN bun install --frozen-lockfile --production --optional

# install drizzle-kit at the version specified in package.json
RUN bun add drizzle-kit@$(bun list drizzle-kit | awk '/drizzle-kit@/ {print $NF}' | sed 's/.*@//') --dev

# 3. THE BUILDER STAGE
# This takes code and the installed packages and runs the Next.js build.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG DATA_SCHEMA
ENV DATA_SCHEMA=${DATA_SCHEMA}
ARG DICT_SCHEMA
ENV DICT_SCHEMA=${DICT_SCHEMA}

# Next.js build produces the .next folder
RUN bun run build

# 4. THE GENERATOR STAGE
FROM base AS generator
COPY --from=builder /app /app

ENV NODE_ENV=production

ARG DATA_SCHEMA
ENV DATA_SCHEMA=${DATA_SCHEMA}
ARG DICT_SCHEMA
ENV DICT_SCHEMA=${DICT_SCHEMA}

# Transpile code for seeding the DB
# We use --packages external to automatically keep node_modules external,
# while correctly bundling local code and resolving tsconfig paths (@/...)
RUN bun build ./src/lib/db/dictionary/seed.ts --outfile ./dist/seed.mjs --target bun --format esm --packages external

# NOTE: we must rely on this outputting to ./migrations 
RUN bun drizzle-kit generate --config drizzle.config.ts 


# 5. THE RUNNER STAGE (The final "Shipping Container")
# We throw away the source code and build tools to keep the image small.
FROM base AS runner
ENV NODE_ENV=production

ARG DATA_SCHEMA
ENV DATA_SCHEMA=${DATA_SCHEMA}
ARG DICT_SCHEMA
ENV DICT_SCHEMA=${DICT_SCHEMA}

ENV SEED_SCRIPT_PATH=/app/dist/seed.mjs

# We only copy the bare essentials needed to run the app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

COPY --from=generator ${SEED_SCRIPT_PATH} ./dist/seed.mjs

COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=generator /app/migrations ./migrations

EXPOSE 3000
CMD ["bun", "run", "start"]
