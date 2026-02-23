import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/data/schema.ts',
  out: './src/db/data',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: `postgres://${Bun.env.DATABASE_USER}:${Bun.env.DATABASE_PASSWORD}@${Bun.env.DATABASE_HOST}:${Bun.env.DATABASE_PORT}/${Bun.env.DATABASE_NAME}`,
  },
});
