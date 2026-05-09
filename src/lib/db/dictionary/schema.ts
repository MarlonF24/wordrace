import * as p from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import {
    type LinkageType,
    LINKAGE_TYPES,
    type RawEntry,
    type Entry,
    type ProcessedlexicalField,
    type SelectableLexicalKey,
} from './types';
import assert from 'node:assert';


const schemaName = process.env.DICT_SCHEMA;
assert(schemaName, "DICT_SCHEMA environment variable must be set")

const tableFunc = (
  schemaName === "public" 
    ? p.snakeCase.table 
    : p.snakeCase.schema(schemaName).table
) as p.PgTableFn<string | undefined>;



const col = (t: LinkageType) => p.jsonb(t).$type<ProcessedlexicalField<Extract<LinkageType, SelectableLexicalKey>>>();

const linkageColumns = Object.fromEntries(LINKAGE_TYPES.map((type) => [type, col(type)])) as {
    [K in LinkageType]: ReturnType<typeof col>;

};



export const dictionaryRaw = tableFunc('dictionary_raw', {
    id: p.integer().primaryKey().generatedAlwaysAsIdentity(),
    raw_data: p.jsonb().notNull().$type<RawEntry>(),
});

const dictionaryTableName = 'dictionary';

const baseDictionaryColumns = {
    word: p
        .text()
        .notNull()
        .$type<string>()
        .references(() => words.word), // lowercase

    pos: p.text().notNull().$type<string>(), // part of speech

};


const lexicalDictionaryColumns = {
    senses: p.jsonb().$type<Entry['senses']>().notNull(),

    categories: p.jsonb().$type<Entry['categories']>(),

    // etymology_text: p.text().$type<string>(),

    ...linkageColumns,
}

export const insertDictionaryColumns = {
    ...baseDictionaryColumns,
    ...lexicalDictionaryColumns,
} satisfies { [K in keyof Entry]: p.Set$Type<unknown, Entry[K]> }


const generatedDictionaryColumns = {
    id: p.integer().primaryKey().generatedAlwaysAsIdentity(),

    allLinks: p.jsonb().generatedAlwaysAs(
        sql`"dictionary".flatten_lexical_blob(
            ${sql.join(
                Object.keys(lexicalDictionaryColumns).map(
                    (k) => sql`COALESCE(${sql.identifier(k)}, '[]'::jsonb)` 
                ),
                sql` || ` 
            )}
        )`
    ),
};

// maybe word and pos together could be the PK, but...
export const dictionary = tableFunc(
    dictionaryTableName,
    { ...insertDictionaryColumns, ...generatedDictionaryColumns },
    (table) => [p.index('idx_word').on(table.word), p.check('lowercase_word', sql`word = lower(word)`)]
);

export const words = tableFunc('words', {
    word: p.text().primaryKey().notNull(), // lowercase
    },
    (table) => [p.check('lowercase_word', sql`word = lower(word)`)]
);
