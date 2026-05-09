import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	dictionaryInDictionary: {
		wordsInDictionary: r.one.wordsInDictionary({
			from: r.dictionaryInDictionary.word,
			to: r.wordsInDictionary.word
		}),
	},
	wordsInDictionary: {
		dictionaryInDictionaries: r.many.dictionaryInDictionary(),
	},
	games: {
		players: r.many.players({
			from: r.games.id.through(r.gamePlayerLink.gameId),
			to: r.players.id.through(r.gamePlayerLink.playerId)
		}),
	},
	players: {
		games: r.many.games(),
	},
}))