# App Routes And UI

This directory contains the Next.js app router pages, server actions, and game UI components.

## Entry Routes

- `layout.tsx`: root layout. Loads the current player from the cookie-backed player service and provides it to the app.
- `page.tsx`: start-game page.
- `start-game-form.tsx`: client form for game setup, game mode, lexical-field selection, hints, and lemmatization.
- `start-game-action.ts`: server action that creates a game and redirects to `/game/[gameId]`.
- `api/search-difficulty/route.ts`: server-only bridge to `search_agent`; it verifies the cookie player/game link, derives filters from game state, and returns a compact route-hint category to the browser.

## Game Route

`game/[gameId]` renders an active game for the current player.

- `layout.tsx`: loads the game once and provides game, pending, and error context to child components.
- `page.tsx`: loads the player/game link, validates lane state, fetches current dictionary records, and chooses normal or collide lane layout.
- `race-lane.tsx`: combines the history sidebar and current-word record display for one side of the race.
- `recordDisplay.tsx`: tabbed display for definitions and selected entry-level lexical fields.
- `senses.tsx`: recursive renderer for nested dictionary senses and their sense-level extra fields.
- `rich-text-renderer.tsx`: renders allowed rich tokens as action buttons and disallowed Wink POS as plain text.
- `route-hint-panel.tsx`: client badge that fetches the optional ML route hint after page load and displays hot/warm/cool/cold/offline states.
- `history.tsx`, `foundPopup.tsx`, `error-display.tsx`, `posBadge.tsx`, `lexicalFieldDisplay.tsx`: supporting display components.

## Rendering Rules

Normal games render one lane from start to target and allow every Wink POS.
Collide games render two lanes and exclude `ADP`, `AUX`, `CCONJ`, `DET`,
`PART`, `PRON`, and `SCONJ`. The same `availablePos` rule applies to prose and
explicit lexical fields, and the server checks it again before updating a race.
Dictionary records still show all Wiktionary entries for the current word.

AI Route Hints are independent of mode. When enabled, the page shows
`RouteHintPanel`, which calls the internal API route rather than the FastAPI
service directly and forwards the persisted lexical-field and Wink POS sets.
