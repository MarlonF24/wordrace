import * as p from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import {
    type RawEntry,
    type WordRecord,
    SELECTABLE_LEXICAL_KEYS,
} from './types';
import assert from 'node:assert';

// Dictionary tables are schema-qualified so seed data can be isolated from game data.
const schemaName = process.env.DICT_SCHEMA;
assert(schemaName, 'DICT_SCHEMA environment variable must be set');

export const schema = schemaName !== 'public' ? p.snakeCase.schema(schemaName) : undefined;
const tableFunc = (schema ? schema.table : p.snakeCase.table) as p.PgTableFn<string | undefined>;

export const selectableLexicalKeysEnum = schema // looks goofy but idk making an enumFunc conditionally breaks
? schema.enum('selectable_lexical_keys', SELECTABLE_LEXICAL_KEYS)
: p.pgEnum('selectable_lexical_keys', SELECTABLE_LEXICAL_KEYS);

// Dummy table makes Drizzle include the selectable lexical-key enum in generated migrations.
export const dummyTable = tableFunc(
    'dummy_table',
    {
        dummy: selectableLexicalKeysEnum().primaryKey(),
    }
);

export const dictionaryRaw = tableFunc('dictionary_raw', {
    id: p.integer().primaryKey().generatedAlwaysAsIdentity(),
    raw_data: p.jsonb().notNull().$type<RawEntry>(),
});

const dictionaryTableName = 'dictionary';

// Processed records are keyed by lowercased word; entries inside the JSON keep their own POS.
export const dictionary = tableFunc(
    dictionaryTableName,
    {
        word: p.text().primaryKey().notNull(),
        lexicalEntries: p.jsonb().notNull().$type<WordRecord['lexicalEntries']>(),
        allLinks: p.jsonb().generatedAlwaysAs(
        sql`flatten_lexical_blob_mapped(
            lexical_entries,
            ARRAY[${sql.join(
                SELECTABLE_LEXICAL_KEYS.map((k) => sql.raw(`'${k}'`)),
                sql`, `
            )}]::text[]
        )`
    ),
    },
    (table) => [p.index('idx_word').on(table.word), p.check('lowercase_word', sql`word = lower(word)`)]
);

export const words = tableFunc(
    'words',
    {
        word: p.text().primaryKey().notNull(), // lowercase
    },
    (table) => [
        p.check('lowercase_word', sql`${table.word} = lower(${table.word})`),
    ]
);
