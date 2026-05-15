import * as p from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import {
    type RawEntry,
    type WordRecord,
    SELECTABLE_LEXICAL_KEYS,
} from './types';
import assert from 'node:assert';

const schemaName = process.env.DICT_SCHEMA;
assert(schemaName, 'DICT_SCHEMA environment variable must be set');

export const schema = schemaName !== 'public' ? p.snakeCase.schema(schemaName) : undefined;
const tableFunc = (schema ? schema.table : p.snakeCase.table) as p.PgTableFn<string | undefined>;

export const selectableLexicalKeysEnum = schema // looks goofy but idk making an enumFunc conditionally breaks
    ? schema.enum('selectable_lexical_keys', SELECTABLE_LEXICAL_KEYS)
    : p.pgEnum('selectable_lexical_keys', SELECTABLE_LEXICAL_KEYS);



export const dictionaryRaw = tableFunc('dictionary_raw', {
    id: p.integer().primaryKey().generatedAlwaysAsIdentity(),
    raw_data: p.jsonb().notNull().$type<RawEntry>(),
});

const dictionaryTableName = 'dictionary';


// maybe word and pos together could be the PK, but...
export const dictionary = tableFunc(
    dictionaryTableName,
    {
        word: p.text().primaryKey().notNull(),
        lexicalEntries: p.jsonb().notNull().$type<WordRecord['lexicalEntries']>(),
    },
    (table) => [p.index('idx_word').on(table.word), p.check('lowercase_word', sql`word = lower(word)`)]
);

export const words = tableFunc(
    'words',
    {
        word: p.text().primaryKey().notNull(), // lowercase
    },
    (table) => [
        p.check('lowercase_word', sql`word = lower(word)`),
    ]
);
