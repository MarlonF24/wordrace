
import {defineConfig} from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/dictionary/schema.ts",
  out: "./src/db/dictionary",
  dialect: "sqlite",
  casing: "snake_case",
  dbCredentials: {
    url: `file:${process.env.DICTIONARY_DB_PATH}`,
  },
});

