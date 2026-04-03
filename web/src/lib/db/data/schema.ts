import * as p from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm";
import { 
  type QueryableExclusiveEntryExtraKey, 
  type QueryableExclusiveSenseExtraKey,
  type QueryableSharedExtraKey,
  type getDictionaryEntries,
  type ExtraFields } from "../dictionary";



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


export const SELECTABLE_EXCLUSIVE_SENSE_EXTRA_FIELDS = [
  "examples"
] as const satisfies ReadonlyArray<QueryableExclusiveSenseExtraKey>;



export const SELECTABLE_EXCLUSIVE_ENTRY_EXTRA_FIELDS = [
  "categories",
  "topics",
] as const satisfies ReadonlyArray<QueryableExclusiveEntryExtraKey>;


export const SELECTABLE_SHARED_EXTRA_FIELDS = [
  "antonyms",
  "synonyms",
  "hypernyms",
  "hyponyms",
  "holonyms",
  "meronyms",
  "derived",
  "related",
] as const satisfies ReadonlyArray<QueryableSharedExtraKey>;

export type SelectableExclusiveSenseExtraKey = typeof SELECTABLE_EXCLUSIVE_SENSE_EXTRA_FIELDS[number];
export type SelectableExclusiveExtraEntryKey = typeof SELECTABLE_EXCLUSIVE_ENTRY_EXTRA_FIELDS[number];
export type SelectableSharedExtraKey = typeof SELECTABLE_SHARED_EXTRA_FIELDS[number];


export type SelectableExtraKey = SelectableExclusiveSenseExtraKey | SelectableExclusiveExtraEntryKey | SelectableSharedExtraKey;
export type SelectableSenseKey = SelectableExclusiveSenseExtraKey | SelectableSharedExtraKey;

export type SelectableEntriesReturn = Awaited<ReturnType<typeof getDictionaryEntries<SelectableSharedExtraKey, SelectableExclusiveExtraEntryKey, SelectableExclusiveSenseExtraKey>>>;

const col = () => p.boolean().default(false).notNull();

export const SELECTABLE_EXTRA_KEYS = [...SELECTABLE_SHARED_EXTRA_FIELDS, ...SELECTABLE_EXCLUSIVE_SENSE_EXTRA_FIELDS, ...SELECTABLE_EXCLUSIVE_ENTRY_EXTRA_FIELDS];

export type ExtraEntryValue<Key extends SelectableExtraKey> = (ExtraFields[Key] extends unknown[] ? ExtraFields[Key][number] : ExtraFields[Key])

export const FIELDS_TO_PRINT: { [K in SelectableExtraKey]: ReadonlyArray<keyof ExtraEntryValue<K>> } = {
  antonyms: ["word"],
  synonyms: ["word"],
  hypernyms: ["word"],
  hyponyms: ["word"],
  holonyms: ["word"],
  meronyms: ["word"],
  derived: ["word"],
  related: ["word"],
  examples: ["text"],
  categories: ["name"],
  topics: [], // assuming topics is array of strings or similar
};

const extraFieldColumns = SELECTABLE_EXTRA_KEYS.reduce((acc, field) => {
  acc[field] = col();
  return acc;
}, {} as Record<SelectableExtraKey, ReturnType<typeof col>>);



export const gameTable = p.pgTable("games", {
  id: p.uuid().primaryKey().defaultRandom(),
  startWord: p.text().notNull(),
  targetWord: p.text().notNull(),
  mode: gameMode().default("normal"),
  createdAt: p.timestamp().defaultNow().notNull(),
  ...extraFieldColumns,
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

