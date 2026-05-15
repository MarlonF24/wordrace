import * as p from "drizzle-orm/pg-core"
import { sql, } from "drizzle-orm";
import { 
  type SelectableExclusiveSenseLexicalKey,
  type SelectableExclusiveEntryLexicalKey,
  type SelectableSharedLexicalKey,
  type SelectableLexicalKey,
} from "../dictionary/types";
import assert from "node:assert";

const schemaName = process.env.DATA_SCHEMA || "public" 
assert(schemaName, "DATA_SCHEMA environment variable must be set")


export const schema = schemaName === 'public' ? undefined : p.snakeCase.schema(schemaName);

const tableFunc = schema
    ? p.snakeCase.schema(schemaName).table
    : (p.snakeCase.table as p.PgTableFn<string | undefined>);

export const playerTable = tableFunc("players", {
  id: p.uuid().primaryKey().defaultRandom(),
  createdAt: p.timestamp({withTimezone: true}).defaultNow().notNull(),
})


export const gameMode = p.pgEnum("game_mode", ["normal", "collide"])
export type GameMode = (typeof gameMode.enumValues)[number];

export const GAME_MODES: Record<GameMode, { label: string; description: string }> = {
  normal: {
    label: "Normal",
    description: "Race from Start to Target",
  },
  collide: {
    label: "Collide",
    description: "Meet in the middle",
  },
} 




export const gameTable = tableFunc("games", {
  id: p.uuid().primaryKey().defaultRandom().notNull(),
  startWord: p.text().notNull(),
  targetWord: p.text().notNull(),
  mode: gameMode().default("normal").notNull(),
  lemmatise: p.boolean().default(true).notNull(),
  createdAt: p.timestamp({withTimezone: true}).defaultNow().notNull(),

  exclusiveEntryLexicalFields: p.jsonb().default({}).$type<Record<SelectableExclusiveEntryLexicalKey, true>>().notNull(),
  exclusiveSenseLexicalFields: p.jsonb().default({}).$type<Record<SelectableExclusiveSenseLexicalKey, true>>().notNull(),
  sharedLexicalFields: p.jsonb().default({}).$type<Record<SelectableSharedLexicalKey, true>>().notNull(),

  entryLexicalFields: p.jsonb().generatedAlwaysAs(sql`(exclusive_entry_lexical_fields || exclusive_sense_lexical_fields || shared_lexical_fields)`).$type<Record<SelectableLexicalKey, true>>().notNull(),
  senseLexicalFields: p.jsonb().generatedAlwaysAs(sql`(exclusive_sense_lexical_fields || shared_lexical_fields)`).$type<Record<SelectableLexicalKey, true>>().notNull(),
  
  lexicalFields: p.jsonb().generatedAlwaysAs(sql`(exclusive_entry_lexical_fields || exclusive_sense_lexical_fields || shared_lexical_fields)`).$type<Record<SelectableLexicalKey, true>>().notNull(),

}, (table) => [
  p.check(
    "unique_start_target", 
    sql`${table.startWord} <> ${table.targetWord}`
  ),
  p.check(
    "at_least_one_lexical_field", 
    sql`${table.lexicalFields} <> '{}'::jsonb`
  ),
]);

export type Game = typeof gameTable.$inferSelect
export type GameInsert = typeof gameTable.$inferInsert

export interface RaceStep {
  word: string;
  timestamp: number;
}

export const gamePlayerLink = tableFunc("game_player_link", {
  gameId: p.uuid().references(() => gameTable.id).notNull(),
  playerId: p.uuid().references(() => playerTable.id).notNull(),
  admin: p.boolean().default(false).notNull(),
  startLinks: p.jsonb().$type<RaceStep[]>().notNull(),
  targetLinks: p.jsonb().$type<RaceStep[]>().notNull(),
  found: p.boolean().generatedAlwaysAs(sql`(start_links -> -1 ->> 'word') = (target_links -> -1 ->> 'word')`).notNull(),
  linkCount: p.integer().generatedAlwaysAs(sql`jsonb_array_length(start_links) - 1 + jsonb_array_length(target_links) - 1`).notNull(),
  durationMs: p.bigint("duration_ms", { mode: "number" }).generatedAlwaysAs(sql`
    greatest(
      (start_links -> -1 ->> 'timestamp')::bigint - (start_links -> 0 ->> 'timestamp')::bigint,
      (target_links -> -1 ->> 'timestamp')::bigint - (target_links -> 0 ->> 'timestamp')::bigint
    )
  `).notNull(),

}, (table) => [
  p.primaryKey({columns: [table.gameId, table.playerId]}),
])


