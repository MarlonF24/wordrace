import * as p from "drizzle-orm/pg-core"
import { sql, } from "drizzle-orm";
import { 
  SELECTABLE_LEXICAL_KEYS,
  type SelectableLexicalKey
} from "../dictionary/types";


export const playerTable = p.pgTable("players", {
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


const col = () => p.boolean().default(false).notNull(); // NOTE: if changing default here, gotta change getEntriesForGame in service.ts as well, which relies on the default value false


const lexicalFieldColumns = SELECTABLE_LEXICAL_KEYS.reduce((acc, field) => {
  acc[field] = col();
  return acc;
}, {} as Record<SelectableLexicalKey, ReturnType<typeof col>>);


export const gameTable = p.pgTable("games", {
  id: p.uuid().primaryKey().defaultRandom(),
  startWord: p.text().notNull(),
  targetWord: p.text().notNull(),
  mode: gameMode().default("normal").notNull(),
  createdAt: p.timestamp({withTimezone: true}).defaultNow().notNull(),
  ...lexicalFieldColumns,
}, (table) => [
  p.check(
    "unique_start_target", 
    sql`${table.startWord} <> ${table.targetWord}`
  ),
]);

export type Game = typeof gameTable.$inferSelect

export interface RaceStep {
  word: string;
  timestamp: number;
}

export const gamePlayerLink = p.pgTable("game_player_link", {
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


