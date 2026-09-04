/** Apply checked-in Drizzle migrations and release the shared Postgres pool. */

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db } from './data/db';
import { pool } from './pool';

try {
    await migrate(db, { migrationsFolder: './migrations' });
    console.log('Database migrations applied.');
} finally {
    await pool.end();
}

