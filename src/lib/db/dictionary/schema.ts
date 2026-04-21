import * as p from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql/sql";

import {
    type LinkageType,
    LINKAGE_TYPES,
    type RawEntry,
    type Entry,
    type ProcessedlexicalField,
    type SelectableLexicalKey
} from "./types";

const col = (t: LinkageType) => p.jsonb(t).$type<ProcessedlexicalField<Extract<LinkageType, SelectableLexicalKey>>>();


const linkageColumns = Object.fromEntries(
    LINKAGE_TYPES.map(type => [type, col(type)])
) as { [K in LinkageType]: ReturnType<typeof col> };



const schemaName = process.env.DICT_TABLE_SCHEMA || "public";

export const schema = p.pgSchema(schemaName);



export const dictionaryRaw = schema.table("dictionary_raw", {
    id: p.integer().primaryKey().generatedAlwaysAsIdentity(),
    raw_data: p.jsonb().notNull().$type<RawEntry>(),
});



const dictionaryColumns = {
    id: p.integer().primaryKey().generatedAlwaysAsIdentity(),
    
    word: p.text().notNull().$type<string>(), // lowercase

    pos: p.text().notNull().$type<string>(), // part of speech
    
    senses: p.jsonb().$type<Entry["senses"]>().notNull(),

    categories: p.jsonb().$type<Entry["categories"]>(),
    
    
    // etymology_text: p.text().$type<string>(),
    
    ...linkageColumns,

} satisfies {id: unknown} & { [K in keyof Entry]: p.Set$Type<unknown, Entry[K]> } 


// maybe word and pos together could be the PK, but... 
export const dictionary = schema.table(
    "dictionary", 
    dictionaryColumns, 
    (table) => [
        p.index("idx_word").on(table.word),
        p.check("lowercase_word", sql`word = lower(word)`),
    ]
);







