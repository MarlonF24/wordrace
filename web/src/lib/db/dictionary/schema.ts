import * as p from "drizzle-orm/pg-core";

interface Linkage {
    word: string; // may also be multiple words but called "word"
}

const LINKAGE_TYPES = [
    "synonyms",
    "antonyms",
    "hypernyms",
    "hyponyms",
    "holonyms",
    "meronyms",

    "derived",
    "related",
    "coordinate_terms",
] as const;

export type LinkageType = typeof LINKAGE_TYPES[number];


const col = (t: LinkageType) => p.jsonb(t).$type<Linkage[]>();

const linkageColumns = Object.fromEntries(
    LINKAGE_TYPES.map(type => [type, col(type)])
) as { [K in LinkageType]: ReturnType<typeof col> };

// extra fields that exist both at entry and sense level
type SharedExtraFields = Record<LinkageType, Linkage[]> & {}
export type SharedExtraFieldKey = keyof SharedExtraFields;


interface Example {
    text: string;
    ref: string;
    type: string;
}

// extra fields that only exist at sense level
type ExclusiveSenseExtraFields = {
    examples: Example[];
    links: [string, string][];
}
export type ExclusiveSenseExtraFieldKey = keyof ExclusiveSenseExtraFields;


// all extra fields on a sense
type SenseExtraFields = ExclusiveSenseExtraFields & SharedExtraFields;
export type SenseExtraFieldKey = keyof SenseExtraFields;


// Sense = default fields + exclusive sense extra fields + shared extra fields
export type Sense = {
    id: string;
    senseid: string[];
    glosses: string[];

} & Partial<SenseExtraFields>; 

type SenseKey = keyof Sense;


interface Category {
    kind: string;
    name: string;
}

const schemaName = process.env.DICT_TABLE_SCHEMA || "public";

export const schema = p.pgSchema(schemaName);



export const dictionaryRaw = schema.table("dictionary_raw", {
    id: p.integer().primaryKey().generatedAlwaysAsIdentity(),
    raw_data: p.jsonb().notNull(),
});

// maybe word and pos together could be the PK, but... 
export const dictionary = schema.table("dictionary", {
    id: p.integer().primaryKey().generatedAlwaysAsIdentity(),
    
    word: p.text().notNull(),
    
    pos: p.text().notNull(), // part of speech
    
    senses: p.jsonb().$type<Sense[]>().notNull(),

    categories: p.jsonb().$type<Category[]>(),
    
    topics: p.jsonb().$type<{ name: string }[]>(),
    
    etymology_text: p.text(),
    
    ...linkageColumns,

}, (table) => [
    p.index("idx_word").on(table.word),
]);


export type Entry = typeof dictionary.$inferSelect;

export type EntryKey = keyof Entry;

// extra fields that only exist at entry level
type ExclusiveEntryExtraFields = Pick<Entry, "categories" | "topics" | "etymology_text">;
export type ExclusiveEntryExtraFieldKey = keyof ExclusiveEntryExtraFields;

// all extra fields on an entry
type EntryExtraFields = Pick<Entry, SharedExtraFieldKey | ExclusiveEntryExtraFieldKey>;

export type ExtraFields = EntryExtraFields & SenseExtraFields;
type ExtraFieldKey = keyof ExtraFields;
