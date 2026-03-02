import {relations} from "./relations"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

const DB_URL = `postgres://${process.env.DATABASE_USER}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`

const pool = new Pool({connectionString: DB_URL})

export const db = drizzle({
  client: pool,
  casing: "snake_case",
  relations: relations,
})
