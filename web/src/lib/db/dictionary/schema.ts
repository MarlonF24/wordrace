import { sqliteTable, index, integer, blob, text } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

import { type InferSelectModel } from "drizzle-orm";

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

// extra fields that exist both at entry and sense level
type SharedExtraFields = Record<LinkageType, Linkage[]> 
export type SharedExtraFieldKey = keyof SharedExtraFields;

const col = (t: LinkageType) => text({ mode: "json" })
    .generatedAlwaysAs(sql`COALESCE(json_extract(raw_data, '$.${t}'), '[]')`, { mode: "virtual" })
    .$type<Linkage[]>()
    .notNull();

const linkageColumns = Object.fromEntries(
    LINKAGE_TYPES.map(type => [type, col(type)])
) as Record<LinkageType, ReturnType<typeof col>>;

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


// CAREFUL: in ./service.ts fields where Boolean(value) is false (e.g. null or []) are removed from the output of the getDictionaryEntries function, so if you ever add a boolean or something else that can be falsy but should be kept in the output, the getDictionaryEntries function needs to be updated
export const dictionary = sqliteTable("dictionary", {
	id: integer().primaryKey({ autoIncrement: true }),
	rawData: blob(),
	
	word: text().generatedAlwaysAs(sql`json_extract(raw_data, '$.word')`, { mode: "virtual" }).notNull(),
	
	pos: text().generatedAlwaysAs(sql`json_extract(raw_data, '$.pos')`, { mode: "virtual" }).notNull(), // part of speech
	
senses: text({mode: "json"}).generatedAlwaysAs(
                sql`json_extract(raw_data, '$.senses')`, { mode: "virtual" }
        ).$type<Sense[]>().notNull(),

        categories: text({mode: "json"}).generatedAlwaysAs(sql`COALESCE(json_extract(raw_data, '$.categories'), '[]')`, { mode: "virtual" }).$type<Category[]>().notNull(),
	
	topics: text().generatedAlwaysAs(sql`json_extract(raw_data, '$.topics')`, { mode: "virtual" }), // gotta find json schema for this and then make blob with json mode, a $type and notNull
	
	etymology_text: text().generatedAlwaysAs(sql`json_extract(raw_data, '$.etymology.text')`, { mode: "virtual" }),
	
	...linkageColumns,
	
},
(table) => [index("idx_word").on(table.word),
]);

export type Entry = InferSelectModel<typeof dictionary>;
export type EntryKey = keyof Entry;

// extra fields that only exist at entry level
type ExclusiveEntryExtraFields = Pick<Entry, "categories" | "topics" | "etymology_text">;
export type ExclusiveEntryExtraFieldKey = keyof ExclusiveEntryExtraFields;

// all extra fields on an entry
type EntryExtraFields = Pick<Entry, SharedExtraFieldKey | ExclusiveEntryExtraFieldKey>;

export type ExtraFields = EntryExtraFields & SenseExtraFields;
type ExtraFieldKey = keyof ExtraFields;