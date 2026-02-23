import {relations} from "./relations"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

const DB_URL = `postgres://${Bun.env.DATABASE_USER}:${Bun.env.DATABASE_PASSWORD}@${Bun.env.DATABASE_HOST}:${Bun.env.DATABASE_PORT}/${Bun.env.DATABASE_NAME}`

const pool = new Pool({connectionString: DB_URL})

const db = drizzle({
  client: pool,
  casing: "snake_case",
  relations: relations,
})

export default db