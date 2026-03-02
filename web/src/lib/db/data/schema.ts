import * as p from "drizzle-orm/pg-core"

export const playerTable = p.pgTable("players", {
  id: p.uuid().primaryKey().defaultRandom(),
  createdAt: p.timestamp().defaultNow(),
})


export const gameTable = p.pgTable("games", {
  id: p.uuid().primaryKey().defaultRandom(),
  start: p.text(),
  target: p.text(),
  createdAt: p.timestamp().defaultNow(),
})

export const gamePlayerLink = p.pgTable("game_player_link", {
  gameId: p.uuid().references(() => gameTable.id),
  playerId: p.uuid().references(() => playerTable.id),
  timeTaken: p.integer(),
  linksTaken: p.integer(),
})

