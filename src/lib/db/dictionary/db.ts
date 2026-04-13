import {relations} from "./relations"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

const DB_URL = `postgres://${process.env.DICT_DB_USER}:${process.env.DICT_DB_PASSWORD}@${process.env.DICT_DB_HOST}:${process.env.DICT_DB_PORT}/${process.env.DICT_DB_NAME}`

const pool = new Pool({connectionString: DB_URL})

export const db = drizzle({
  client: pool,
  casing: "snake_case",
  relations: relations,
})
