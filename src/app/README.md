# App Routes And UI

This directory contains the Next.js app router pages, server actions, and game UI components.

## Entry Routes

- `layout.tsx`: root layout. Loads the current player from the cookie-backed player service and provides it to the app.
- `page.tsx`: start-game page.
- `start-game-form.tsx`: client form for game setup, lexical-field selection, lemmatization, and game mode.
- `start-game-action.ts`: server action that creates a game and redirects to `/game/[gameId]`.

## Game Route

`game/[gameId]` renders an active game for the current player.

- `layout.tsx`: loads the game once and provides game, pending, and error context to child components.
- `page.tsx`: loads the player/game link, validates lane state, fetches current dictionary records, and chooses normal or collide lane layout.
- `race-lane.tsx`: combines the history sidebar and current-word record display for one side of the race.
- `recordDisplay.tsx`: tabbed display for definitions and selected entry-level lexical fields.
- `senses.tsx`: recursive renderer for nested dictionary senses and their sense-level extra fields.
- `rich-text-renderer.tsx`: converts `RichText` tokens into clickable word buttons or plain text when collide-mode prose suppresses function words.
- `word-button.tsx`: client action button for adding a clicked rich token to the current lane.
- `history.tsx`, `foundPopup.tsx`, `error-display.tsx`, `posBadge.tsx`, `lexicalFieldDisplay.tsx`: supporting display components.

## Rendering Rules

Normal games render one lane from start to target. Collide games render two lanes, one from each endpoint, and use function-word suppression only in definition prose. Explicit lexical-field badges remain clickable.
