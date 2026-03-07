import * as p from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm";


export const playerTable = p.pgTable("players", {
  id: p.uuid().primaryKey().defaultRandom(),
  createdAt: p.timestamp().defaultNow().notNull(),
})


export const gameTable = p.pgTable("games", {
  id: p.uuid().primaryKey().defaultRandom(),
  startWord: p.text().notNull(),
  targetWord: p.text().notNull(),
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
  links: p.jsonb().$type<RaceStep[]>().default(sql`'[]'::jsonb`).notNull(),
}, (table) => ({
  pk: p.primaryKey({columns: [table.gameId, table.playerId]}),
}))

