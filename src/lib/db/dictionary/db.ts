import {relations} from "./relations"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"


const pool = new Pool({
  user: process.env.DICT_DB_USER,
  host: process.env.DICT_DB_HOST,
  database: process.env.DICT_DB_NAME,
  password: process.env.DICT_DB_PASSWORD,
  port: Number(process.env.DICT_DB_PORT),
})

export const db = drizzle({
  client: pool,
  casing: "snake_case",
  relations: relations,
})
