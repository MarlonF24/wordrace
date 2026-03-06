import { defineConfig } from 'drizzle-kit';

console.log("DEBUG: Database URL is ->", `postgres://${process.env.DATABASE_USER}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`);

export default defineConfig({
  schema: './src/lib/db/data/schema.ts',
  out: './src/db/data',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: `postgres://${process.env.DATABASE_USER}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`,
  },
});
