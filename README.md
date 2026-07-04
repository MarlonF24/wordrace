# WordRace Web

WordRace is a Next.js application for creating and playing word-link races over a processed Wiktionary/WordNet-style dictionary. Players click words embedded in definitions and lexical fields to move from a start word toward a target word. Collide mode gives each player two lanes, one from each end, and ends when both lanes meet.

## Mental Model

The app has three main layers:

- `src/app`: Next.js routes, server actions, and game UI components.
- `src/lib/db`: Drizzle schemas, database clients, and domain services for game state and dictionary records.
- `src/lib/lemmatisation.ts` and `src/lib/part-of-speech.ts`: text tokenization, lemmatization, POS mapping, and function-word filtering policy.

The database is split into two logical schemas:

- `dictionary`: source and processed lexical data. The processed `dictionary` table stores rich JSONB entries and a generated `all_links` field for graph/search consumers.
- `data` or `public`: player IDs, games, and each player's race history for a game.

## Game Flow

1. `src/proxy.ts` assigns each browser a long-lived `playerId` cookie.
2. `src/app/start-game-form.tsx` collects start/target words, game mode, lemmatization, and selected lexical fields.
3. `src/app/start-game-action.ts` calls `DATA_DB.createGame`.
4. `src/lib/db/data/service.ts` normalizes the start/target words, validates dictionary availability, rejects collide-mode function words at the endpoints, creates the game, and joins the creating player.
5. `src/app/game/[gameId]/page.tsx` loads the current game/player link and chooses normal or collide lane rendering.
6. `src/app/game/[gameId]/word-button.tsx` submits clicked rich tokens to `addRaceStep`, which validates the next word and appends it to the correct lane.

## Rich Text And Links

Dictionary prose is stored as `RichText`, an array of strings and `RichToken` objects:

```ts
type RichToken = {
    l: string;
    p: WiktionaryPosTag;
    w: string;
};
```

- `w` is the displayed surface word.
- `l` is the lemma used when a game is configured with lemmatization.
- `p` is a Wiktionary-style part-of-speech tag derived from Wink NLP.

`RichTextRenderer` turns rich tokens into clickable `WordButton`s. In collide mode, definition prose suppresses function words such as determiners, pronouns, prepositions, conjunctions, particles, and auxiliary lemmas. Explicit lexical fields such as synonyms and hypernyms stay clickable, because those are intentional dictionary links rather than incidental prose shortcuts.

## Dictionary Processing

The dictionary seed pipeline lives in `src/lib/db/dictionary/seed.ts`.

- Raw Kaikki/Wiktionary JSONL is loaded into `dictionary_raw`.
- Raw entries are grouped by lowercased word.
- `processRawEntry` converts raw entries into display-ready `LexicalEntry` objects.
- `tokenizeToRichText` converts glossary/example text and displayed object fields into rich tokens.
- `processSenses` turns repeated Wiktionary gloss paths into a tree of `GlossNode`s so the UI can render nested senses without repeating shared parent gloss text.

The generated `all_links` column is intentionally based on `w` and `l` link data. POS metadata is for rendering/filtering, not for graph search.

## Commands

Run these from `web/`:

```bash
bun run dev
bunx tsc --noEmit
bun run lint
bun run build
bun run db:push
```

`bun run lint` should complete without errors or warnings.

## Environment

The app expects database connection variables for the dictionary/data schemas. The schema modules read:

- `DICT_SCHEMA`: schema for dictionary tables.
- `DATA_SCHEMA`: schema for game/player tables, defaulting to `public`.
- Standard Postgres connection values used by the DB clients and seed scripts.
- `SEED_DATA_PATH`: JSONL source path used by the dictionary seed script.

## Operational Notes

- Reseed processed dictionary data after changing `RichToken`, lexical-field processing, or tokenization behavior.
- If `drizzle push` makes dictionary performance worse, reseed the dictionary data; the local note in `src/lib/db/dictionary/README.md` records this failure mode.
- Avoid adding compatibility layers for old rich-token JSON shapes unless there is an explicit migration requirement.

## Credits And Data Sources

This project uses Open English WordNet and Kaikki/Wiktionary-derived dictionary data.

The dictionary data was obtained from: https://kaikki.org/dictionary/English/index.html

### Citations

* Open English WordNet: John P. McCrae, Alexandre Rademaker, Francis Bond, Ewa Rudnicka and Christiane Fellbaum (2019) *English WordNet 2019 - An Open-Source WordNet for English*. In Proceedings of the 10th Global WordNet Conference (GWC 2019), Wroclaw, Poland.
    [Website: https://en-word.net/](https://en-word.net/)

* Princeton WordNet (Original):
    Christiane Fellbaum (1998, ed.) *WordNet: An Electronic Lexical Database*. Cambridge, MA: MIT Press.

### License

The data is provided under the [Creative Commons Attribution 4.0 International (CC-BY 4.0)](https://creativecommons.org/licenses/by/4.0/) license.
