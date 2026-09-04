import * as p from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  type SelectableExclusiveSenseLexicalKey,
  type SelectableExclusiveEntryLexicalKey,
  type SelectableSharedLexicalKey,
  type SelectableLexicalKey,
} from "../dictionary/types";
import { GAME_MODE_VALUES } from '@/lib/game-modes';
import { type WinkPosTag, WINK_POS_TAGS } from "@/lib/part-of-speech";
import { SETTINGS } from '@/settings';

// Live game data can live in `public` or in a configured schema for isolated environments.
const schemaName = SETTINGS.dataSchema;

export const schema = schemaName === 'public' ? undefined : p.snakeCase.schema(schemaName);

const tableFunc = schema
    ? p.snakeCase.schema(schemaName).table
    : (p.snakeCase.table as p.PgTableFn<string | undefined>);

export const playerTable = tableFunc("players", {
  id: p.uuid().primaryKey().defaultRandom(),
  createdAt: p.timestamp({withTimezone: true}).defaultNow().notNull(),
});

export const gameMode = p.pgEnum("game_mode", GAME_MODE_VALUES);

// JSONB objects store set-like collections without duplicate values.
export type SetLike<T extends string> = Partial<Record<T, true>>;

export function setLikeToArray<T extends string>(setlike: SetLike<T>): T[] {
  return Object.keys(setlike) as T[];
}

// Games store immutable setup plus generated lexical-field unions for querying records.
export const gameTable = tableFunc("games", {
  id: p.uuid().primaryKey().defaultRandom().notNull(),
  startWord: p.text().notNull(),
  targetWord: p.text().notNull(),
  mode: gameMode().default("normal").notNull(),
  lemmatise: p.boolean().default(true).notNull(), // whether to lemmatise words for dictionary lookups
  aiHintsEnabled: p.boolean().default(false).notNull(), // whether to give hints for closeness to the target word using ML search
  createdAt: p.timestamp({withTimezone: true}).defaultNow().notNull(),

  availablePos: p.jsonb().$type<SetLike<WinkPosTag>>().default(Object.fromEntries(WINK_POS_TAGS.map((v) => [v, true]))).notNull(),

  exclusiveEntryLexicalFields: p.jsonb().$type<SetLike<SelectableExclusiveEntryLexicalKey>>().default({}).notNull(),
  exclusiveSenseLexicalFields: p.jsonb().$type<SetLike<SelectableExclusiveSenseLexicalKey>>().default({}).notNull(),
  sharedLexicalFields: p.jsonb().$type<SetLike<SelectableSharedLexicalKey>>().default({}).notNull(),

  entryLexicalFields: p.jsonb().generatedAlwaysAs(sql`(exclusive_entry_lexical_fields || exclusive_sense_lexical_fields || shared_lexical_fields)`).$type<SetLike<SelectableLexicalKey>>().notNull(),
  senseLexicalFields: p.jsonb().generatedAlwaysAs(sql`(exclusive_sense_lexical_fields || shared_lexical_fields)`).$type<SetLike<SelectableLexicalKey>>().notNull(),
  
  lexicalFields: p.jsonb().generatedAlwaysAs(sql`(exclusive_entry_lexical_fields || exclusive_sense_lexical_fields || shared_lexical_fields)`).$type<SetLike<SelectableLexicalKey>>().notNull(),

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

export type Game = typeof gameTable.$inferSelect;
export type GameInsert = typeof gameTable.$inferInsert;

export interface RaceStep {
  word: string;
  timestamp: number;
}

// Player links store mutable race history and generated completion/stat fields.
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
]);
