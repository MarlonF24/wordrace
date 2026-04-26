import { defineConfig } from 'drizzle-kit';


const user = process.env.DB_USER;
const password = process.env.DB_PASSWORD;
const host = process.env.DB_HOST;
const port = process.env.DB_PORT;
const name = process.env.DB_NAME;

const dictUser = process.env.DICT_DB_USER;
const dictPassword = process.env.DICT_DB_PASSWORD;
const dictHost = process.env.DICT_DB_HOST;
const dictPort = process.env.DICT_DB_PORT;
const dictName = process.env.DICT_DB_NAME;

const url = `postgres://${user}:${password}@${host}:${port}/${name}`;
// console.debug("Data DB URL is ->", url);
const dictUrl = `postgres://${dictUser}:${dictPassword}@${dictHost}:${dictPort}/${dictName}`;
// console.debug("Dictionary DB URL is ->", dictUrl);

if (url !== dictUrl) {
  throw new Error("Data DB URL and Dictionary DB URL do not match, this config was made to put both their schemas in one database.");
}

export default defineConfig({
  schema: ['./src/lib/db/data/schema.ts', "./src/lib/db/dictionary/schema.ts"],
  out: './src/lib/db',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: url,
  },
  schemaFilter: ["public", "dictionary"] // essential to not delete other schemas like an ML schema for the AI Player
});
