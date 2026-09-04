# Dictionary Module

This module owns the processed lexical database used by the game UI and by graph/search consumers.

## Files

- `schema.ts`: Drizzle schema for raw dictionary rows, processed dictionary rows, and the generated `allLinks` column.
- `types.ts`: raw Kaikki entry shapes, selectable lexical-field unions, processed `WordRecord` shapes, and `RichText`/`RichToken`.
- `seed.ts`: bulk loader and processor from JSONL into processed dictionary JSONB.
- `service.ts`: query-time filtering of processed records by selected lexical fields.
- `custom_migrations.sql`: source SQL for `flatten_lexical_blob_mapped`, which extracts link targets from processed JSONB.

## Data Shape

Raw Kaikki entries are grouped by lowercased word, then converted into `WordRecord`:

- `WordRecord.word`: lowercased dictionary key.
- `WordRecord.lexicalEntries`: entries grouped under the same word, each with a part of speech, nested senses, and optional selected entry-level lexical fields.
- `GlossNode`: a tree representation of Wiktionary gloss paths. Child nodes store only the lexical data that differs from their parent.
- `RichText`: strings plus clickable `RichToken` objects.
- `LexicalEntry.pos`: the lowercase Wiktionary POS supplied by the dictionary source.
- `RichToken`: `{ w, l, p }`, where `w` is the surface word, `l` is the lemma, and `p` is an uppercase Wink NLP POS used by games and search.

## Processing Flow

1. `loadRawData` streams the JSONL source into `dictionary_raw`.
2. `hydrateWithProcessing` groups raw rows by lowercased word.
3. `processRawEntry` extracts entry-level fields and delegates senses to `processSenses`.
4. `processSenses` builds a gloss tree and avoids repeating parent gloss text on every child.
5. `processObjectLexicalField` tokenizes printable object fields, such as synonym words or example text, into `RichText`.

## Query Flow

`getWordRecord` fetches a processed record by lowercased word and filters it to
the selected lexical fields for a game. It keeps every matching Wiktionary
entry and throws when the word does not exist or the requested fields contain
nothing displayable for that word.

Filtering happens on already-processed JSONB. It does not mutate the stored dictionary rows.

## Search Contract

The generated `allLinks` field is for graph/search consumers. Its shape is
`w|l -> lexical key -> POS -> words`. Consumers select the raw-word or lemma
branch once, then traverse only the admitted lexical fields and target POS
buckets.

`search_agent` still traverses `w` or `l` strings. The uppercase Wink POS attached
to each target is a game/search filter dimension, not a replacement for link
words or the source entry's Wiktionary POS.

## Operational Note

`drizzle push` can sometimes make dictionary performance worse by reinserting rows or changing JSON handling. If performance drops after a push, reseed the dictionary data, especially when Drizzle creates a temporary `__new_dictionary` table and renames it back to `dictionary`.

After changing `RichToken`, POS parsing, or `flatten_lexical_blob_mapped`, reseed processed dictionary rows and regenerate `apps/search_agent/search/graph/*.parquet`.
