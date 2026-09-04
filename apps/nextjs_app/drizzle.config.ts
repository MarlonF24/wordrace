import { defineConfig } from 'drizzle-kit';
import { SETTINGS } from './src/settings';

// WHATWG URL encoding keeps reserved characters in credentials from corrupting the DSN.
const databaseUrl = new URL('postgresql://localhost');
databaseUrl.username = SETTINGS.dbUser;
databaseUrl.password = SETTINGS.dbPassword;
databaseUrl.hostname = SETTINGS.dbHost;
databaseUrl.port = String(SETTINGS.dbPort);
databaseUrl.pathname = `/${SETTINGS.dbName}`;

export default defineConfig({
    schema: ['./src/lib/db/data/schema.ts', './src/lib/db/dictionary/schema.ts'],
    out: './migrations',
    dialect: 'postgresql',
    dbCredentials: {
        url: databaseUrl.toString(),
    },
    // Exclude unrelated schemas such as the ML embedding store.
    schemaFilter: [SETTINGS.dataSchema, SETTINGS.dictSchema],
});
