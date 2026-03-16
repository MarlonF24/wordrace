import * as p from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm";


export const playerTable = p.pgTable("players", {
  id: p.uuid().primaryKey().defaultRandom(),
  createdAt: p.timestamp().defaultNow().notNull(),
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

export const gameTable = p.pgTable("games", {
  id: p.uuid().primaryKey().defaultRandom(),
  startWord: p.text().notNull(),
  targetWord: p.text().notNull(),
  mode: gameMode().default("normal"),
  createdAt: p.timestamp().defaultNow().notNull(),
})

export interface RaceStep {
  word: string;
  timestamp: string;
}

export const gamePlayerLink = p.pgTable("game_player_link", {
  gameId: p.uuid().references(() => gameTable.id).notNull(),
  playerId: p.uuid().references(() => playerTable.id).notNull(),
  admin: p.boolean().default(false).notNull(),
  startLinks: p.jsonb().$type<RaceStep[]>().default(sql`'[]'::jsonb`).notNull(),
  targetLinks: p.jsonb().$type<RaceStep[]>().default(sql`'[]'::jsonb`).notNull(),
}, (table) => ({
  pk: p.primaryKey({columns: [table.gameId, table.playerId]}),
}))

