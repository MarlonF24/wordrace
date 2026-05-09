import { defineConfig } from 'drizzle-kit';
import assert from 'node:assert';


const user = process.env.DB_USER;
const password = process.env.DB_PASSWORD;
const host = process.env.DB_HOST;
const port = process.env.DB_PORT;
const name = process.env.DB_NAME;

const dataSchema = process.env.DATA_SCHEMA;
assert(dataSchema, "DATA_SCHEMA environment variable is not set");

const dictSchema = process.env.DICT_SCHEMA;
assert(dictSchema, "DICT_SCHEMA environment variable is not set");


const url = `postgres://${user}:${password}@${host}:${port}/${name}`;
console.debug("DB URL is ->", url);


export default defineConfig({
  schema: ['./src/lib/db/data/schema.ts', "./src/lib/db/dictionary/schema.ts"],
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: url,
  },
  schemaFilter: [dataSchema, dictSchema] // essential to not delete other schemas like an ML schema for the AI Player
});
