import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { relations } from "./relations";


const DB_PATH = Bun.env.DICTIONARY_DB_PATH || "db.sqlite";
console.debug("Using database at path:", DB_PATH);
const _db = new Database(DB_PATH);
const db = drizzle({client: _db, relations});

export default db;