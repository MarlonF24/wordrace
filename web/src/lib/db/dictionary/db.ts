import { drizzle } from "drizzle-orm/libsql";
import { relations } from "./relations"


const DB_PATH = process.env.DICTIONARY_DB_PATH || "db.sqlite";

export const db = drizzle("file:" + DB_PATH, { relations, casing: "snake_case" });

