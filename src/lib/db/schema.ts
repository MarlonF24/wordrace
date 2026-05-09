import { pgSchema, pgEnum, pgTable, uuid, text, integer, timestamp, jsonb, boolean, bigint, index, foreignKey, primaryKey, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const dictionary = pgSchema("dictionary");
export const gameMode = pgEnum("game_mode", ["normal", "collide"])


export const dictionaryInDictionary = dictionary.table("dictionary", {
	word: text().notNull().references(() => wordsInDictionary.word),
	pos: text().notNull(),
	senses: jsonb().notNull(),
	categories: jsonb(),
	synonyms: jsonb(),
	antonyms: jsonb(),
	hypernyms: jsonb(),
	hyponyms: jsonb(),
	holonyms: jsonb(),
	meronyms: jsonb(),
	derived: jsonb(),
	related: jsonb(),
	coordinateTerms: jsonb("coordinate_terms"),
	id: integer().primaryKey().generatedAlwaysAsIdentity(),
	allLinks: jsonb("all_links").generatedAlwaysAs(sql`dictionary.flatten_lexical_blob(((((((((((COALESCE(senses, '[]'::jsonb) || COALESCE(categories, '[]'::jsonb)) || COALESCE(synonyms, '[]'::jsonb)) || COALESCE(antonyms, '[]'::jsonb)) || COALESCE(hypernyms, '[]'::jsonb)) || COALESCE(hyponyms, '[]'::jsonb)) || COALESCE(holonyms, '[]'::jsonb)) || COALESCE(meronyms, '[]'::jsonb)) || COALESCE(derived, '[]'::jsonb)) || COALESCE(related, '[]'::jsonb)) || COALESCE(coordinate_terms, '[]'::jsonb)))`),
}, (table) => [
	index("idx_word").using("btree", table.word.asc().nullsLast()),
check("lowercase_word", sql`(word = lower(word))`),]);

export const dictionaryRawInDictionary = dictionary.table("dictionary_raw", {
	id: integer().primaryKey().generatedAlwaysAsIdentity(),
	rawData: jsonb("raw_data").notNull(),
});

export const wordsInDictionary = dictionary.table("words", {
	word: text().primaryKey(),
}, (table) => [
check("lowercase_word", sql`(word = lower(word))`),]);

export const gamePlayerLink = pgTable("game_player_link", {
	gameId: uuid("game_id").notNull().references(() => games.id),
	playerId: uuid("player_id").notNull().references(() => players.id),
	admin: boolean().default(false).notNull(),
	startLinks: jsonb("start_links").notNull(),
	targetLinks: jsonb("target_links").notNull(),
	found: boolean().notNull().generatedAlwaysAs(sql`(((start_links -> '-1'::integer) ->> 'word'::text) = ((target_links -> '-1'::integer) ->> 'word'::text))`),
	linkCount: integer("link_count").notNull().generatedAlwaysAs(sql`(((jsonb_array_length(start_links) - 1) + jsonb_array_length(target_links)) - 1)`),
	durationMs: bigint("duration_ms", { mode: 'number' }).notNull().generatedAlwaysAs(sql`GREATEST(((((start_links -> '-1'::integer) ->> 'timestamp'::text))::bigint - (((start_links -> 0) ->> 'timestamp'::text))::bigint), ((((target_links -> '-1'::integer) ->> 'timestamp'::text))::bigint - (((target_links -> 0) ->> 'timestamp'::text))::bigint))`),
}, (table) => [
	primaryKey({ columns: [table.gameId, table.playerId], name: "game_player_link_pkey"}),
]);

export const games = pgTable("games", {
	id: uuid().defaultRandom().primaryKey(),
	startWord: text("start_word").notNull(),
	targetWord: text("target_word").notNull(),
	mode: gameMode().default("normal").notNull(),
	lemmatise: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
	exclusiveEntryLexicalFields: jsonb("exclusive_entry_lexical_fields").default({}).notNull(),
	exclusiveSenseLexicalFields: jsonb("exclusive_sense_lexical_fields").default({}).notNull(),
	sharedLexicalFields: jsonb("shared_lexical_fields").default({}).notNull(),
	entryLexicalFields: jsonb("entry_lexical_fields").notNull().generatedAlwaysAs(sql`((exclusive_entry_lexical_fields || exclusive_sense_lexical_fields) || shared_lexical_fields)`),
	senseLexicalFields: jsonb("sense_lexical_fields").notNull().generatedAlwaysAs(sql`(exclusive_sense_lexical_fields || shared_lexical_fields)`),
	lexicalFields: jsonb("lexical_fields").notNull().generatedAlwaysAs(sql`((exclusive_entry_lexical_fields || exclusive_sense_lexical_fields) || shared_lexical_fields)`),
}, (table) => [
check("at_least_one_lexical_field", sql`(lexical_fields <> '{}'::jsonb)`),check("unique_start_target", sql`(start_word <> target_word)`),]);

export const players = pgTable("players", {
	id: uuid().defaultRandom().primaryKey(),
	createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
});
