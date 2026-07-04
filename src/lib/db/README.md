# Database Layer

The database layer is split into dictionary data and live game data.

## Dictionary Data

`dictionary/` owns the processed lexical source used to render records and to expose graph links. It contains the raw and processed dictionary schemas, the seed pipeline, domain types, and record filtering service.

## Game Data

`data/` owns players, games, player-game links, and race history.

- `schema.ts`: Drizzle tables and generated fields for game state.
- `service.ts`: domain operations for creating players, creating games, joining games, loading records for a game, and appending race steps.
- `actions.ts`: server-action wrappers for client components.
- `db.ts` and `relations.ts`: Drizzle client and relationship wiring.

## Shared DB Utilities

- `pool.ts`: Postgres pool construction used by Drizzle clients.
- `index.ts`: convenience exports for the two schema-specific modules.

Game services validate dictionary records before inserting or appending race steps. This keeps UI clicks and direct server action calls on the same integrity path.
