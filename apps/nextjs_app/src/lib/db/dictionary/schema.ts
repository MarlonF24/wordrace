import * as p from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import {
    type RawEntry,
    type WordRecord,
    SELECTABLE_LEXICAL_KEYS,
} from './types';
import { WIKTIONARY_POS_TAGS, WINK_POS_TAGS } from '@/lib/part-of-speech';
import { SETTINGS } from '@/settings';

// Dictionary tables are schema-qualified so seed data can be isolated from game data.
const schemaName = SETTINGS.dictSchema;

export const schema = schemaName !== 'public' ? p.snakeCase.schema(schemaName) : undefined;
const tableFunc = (schema ? schema.table : p.snakeCase.table) as p.PgTableFn<string | undefined>;

export const selectableLexicalKeysEnum = schema // looks goofy but idk making an enumFunc conditionally breaks
? schema.enum('selectable_lexical_key', SELECTABLE_LEXICAL_KEYS)
: p.pgEnum('selectable_lexical_key', SELECTABLE_LEXICAL_KEYS);

export const wiktionaryPosTagsEnum = schema
    ? schema.enum('wiktionary_pos_tag', WIKTIONARY_POS_TAGS)
    : p.pgEnum('wiktionary_pos_tag', WIKTIONARY_POS_TAGS);

export const winkPosTagsEnum = schema
    ? schema.enum('wink_pos_tag', WINK_POS_TAGS)
    : p.pgEnum('wink_pos_tag', WINK_POS_TAGS);

// Dummy table makes Drizzle include the selectable lexical-key enum in generated migrations.
export const dummyTable = tableFunc(
    'dummy_table',
    {
        selectableLexicalKeysDummy: selectableLexicalKeysEnum().notNull(),
        wiktionaryPosTagsDummy: wiktionaryPosTagsEnum().notNull(),
        winkPosTagsDummy: winkPosTagsEnum().notNull(),
    },
    (table) => [
        p.primaryKey({
            columns: [
                table.selectableLexicalKeysDummy,
                table.wiktionaryPosTagsDummy,
                table.winkPosTagsDummy,
            ],
        }),
    ]
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
