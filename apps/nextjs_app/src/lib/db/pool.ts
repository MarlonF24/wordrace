import { Pool } from "pg"
import { SETTINGS } from '@/settings';

export const pool = new Pool({
  user: SETTINGS.dbUser,
  host: SETTINGS.dbHost,
  database: SETTINGS.dbName,
  password: SETTINGS.dbPassword,
  port: SETTINGS.dbPort,
})
