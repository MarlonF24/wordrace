/** Typed, immutable server configuration resolved from environment variables. */

import {
    Settings,
    createSyncSettings,
    fromEnvironmentSync,
} from 'tydantic-settings';

const settingsSchema = Settings({
    dbHost: Settings.String({ default: 'localhost', minLength: 1 }),
    dbPort: Settings.Number({ default: 5432, minimum: 1, maximum: 65_535 }),
    dbName: Settings.String({ default: 'wordrace', minLength: 1 }),
    dbUser: Settings.String({ default: 'postgres', minLength: 1 }),
    dbPassword: Settings.String({ default: '12345678', minLength: 1 }),
    dataSchema: Settings.String({ default: 'public', minLength: 1 }),
    dictSchema: Settings.String({ default: 'dictionary', minLength: 1 }),
    searchAgentUrl: Settings.String({
        default: 'http://localhost:8000',
        minLength: 1,
    }),
    seedDataPath: Settings.Optional(Settings.String({ minLength: 1 })),
});

export const SETTINGS = createSyncSettings(
    settingsSchema,
    [fromEnvironmentSync()],
    { nestingSeparator: '__' }
);
