import {db} from "./db";
import {playerTable, gameTable, gamePlayerLink, type RaceStep, type GameMode, type SelectableExtraKey} from "./schema";
import { DICTIONARY_DB } from "@/lib/db";
import { getLemmaInContext } from "@/lib/lemmatisation";
import { eq, and, sql, InferInsertModel } from "drizzle-orm";

import { type InferSelectModel } from "drizzle-orm";

import { 
    SELECTABLE_EXCLUSIVE_SENSE_EXTRA_KEYS, 
    SELECTABLE_EXCLUSIVE_ENTRY_EXTRA_KEYS, 
    SELECTABLE_SHARED_EXTRA_KEYS } from "./schema";

import { getDictionaryEntries } from "../dictionary";

export async function createPlayer(playerID: string) {
    
    const [player] = await db.insert(playerTable).values({
        id: playerID,
        createdAt: new Date(),
    }).returning();
    return player;
}




export async function getGamePlayerLink(
    gameId: string, 
    playerId: string, 
) {

    return await db.query.gamePlayerLink.findFirst({
        where: {
            gameId: gameId,
            playerId: playerId
        }
    });

}

export type CreateGameData = InferInsertModel<typeof gameTable> & { id?: never, createdAt?: never };

export async function createGame(playerID: string, gameData: CreateGameData) {

    const { startWord, targetWord, mode, ...extraFields } = gameData;
    
    const lemmaStart = getLemmaInContext(startWord, 0).lemma;
    const lemmaTarget = getLemmaInContext(targetWord, 0).lemma;

    if (!lemmaStart || !lemmaTarget) {
        throw new Error("Could not extract lemma from start or target word");
    } else if (lemmaStart === lemmaTarget) {
        throw new Error("Start and target words cannot be the same");
    }

    const existsStart = DICTIONARY_DB.db.query.dictionary.findFirst({
        where: {
            word: lemmaStart
        },
        columns: {
            id: true
        }
    });

    const existsTarget = DICTIONARY_DB.db.query.dictionary.findFirst({
        where: {
            word: lemmaTarget
        },
        columns: {
            id: true
        }
    });

    const [startEntry, targetEntry] = await Promise.all([existsStart, existsTarget]);

    if (!startEntry) {
        throw new Error(`Start word "${lemmaStart}" does not exist in the dictionary`);
    }

    if (!targetEntry) {
        throw new Error(`Target word "${lemmaTarget}" does not exist in the dictionary`);
    }

    const [game] = await db.insert(gameTable).values({
        startWord: lemmaStart,
        targetWord: lemmaTarget,
        mode,
        ...extraFields,
    }).returning()

    console.debug("Created game with start word:", lemmaStart, "and target word:", lemmaTarget, "for player ID:", playerID, "with extra fields:", extraFields);

    await joinGame(playerID, game, true);

    return game
}

export async function joinGame(playerId: string, game: InferSelectModel<typeof gameTable>, admin: boolean = false) {

    const time = Date.now();
    await db.insert(gamePlayerLink).values({
        gameId: game.id,
        playerId: playerId,
        admin: admin,
        startLinks: [{ word: game.startWord, timestamp: time }],
        targetLinks: [{ word: game.targetWord, timestamp: time }],
    })
}

export async function getEntriesForGame(game: InferSelectModel<typeof gameTable>, word: string) {
    const senseExtraFields = SELECTABLE_EXCLUSIVE_SENSE_EXTRA_KEYS.filter(field => game[field]);
    const extraEntryFields = SELECTABLE_EXCLUSIVE_ENTRY_EXTRA_KEYS.filter(field => game[field]);
    const sharedExtraFields = SELECTABLE_SHARED_EXTRA_KEYS.filter(field => game[field]);


    return getDictionaryEntries(word, sharedExtraFields, senseExtraFields, extraEntryFields);
}


export async function  addRaceStep(gameId: string, playerId: string, sentence: string, wordIdx: number, side: "start" | "target" = "start") {
    const { lemma } = getLemmaInContext(sentence, wordIdx);
    const cleanLemma = lemma.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
        
    if (!cleanLemma) throw new Error("Lemma is empty after cleaning, cannot add race step");

    

    // check if the word exists in the dictionary before adding
    if (!await DICTIONARY_DB.db.query.dictionary.findFirst({
        where: {
            word: cleanLemma
        },
        columns: {
            id: true
        }
    })) {
        throw new Error(`Word "${cleanLemma}" does not exist in the dictionary`);
    }


    const newStep: RaceStep = {
        word: cleanLemma,
        timestamp: Date.now(),
    };

    let updatedLink;

    if (side === "start") {
        [updatedLink] = await db.update(gamePlayerLink)
        .set({
            startLinks: sql`${gamePlayerLink.startLinks} || ${JSON.stringify([newStep])}::jsonb`,
        })
        .where(and(
            eq(gamePlayerLink.gameId, gameId),
            eq(gamePlayerLink.playerId, playerId)
        )).returning();
    } else {
        [updatedLink] = await db.update(gamePlayerLink)
        .set({
            targetLinks: sql`${gamePlayerLink.targetLinks} || ${JSON.stringify([newStep])}::jsonb`,
        })
        .where(and(
            eq(gamePlayerLink.gameId, gameId),
            eq(gamePlayerLink.playerId, playerId)
        )).returning();
    }

    return {newStep, found: updatedLink.found};
}