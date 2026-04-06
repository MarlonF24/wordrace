import {db} from "./db";
import {playerTable, gameTable, gamePlayerLink, type RaceStep, type GameMode, type SelectableExtraKey} from "./schema";
import { DICTIONARY_DB } from "@/lib/db";
import { getLemmaInContext } from "@/lib/lemmatisation";
import { eq, and, sql } from "drizzle-orm";

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

export async function createGame(playerID: string, startWord: string, targetWord: string, mode: GameMode = "normal", extraFields: SelectableExtraKey[] = []) {

    
    const extraFieldsData = Object.fromEntries(extraFields.map(field => [field, true])) as { [K in SelectableExtraKey]?: true };

    const lemmaStart = getLemmaInContext(startWord, 0).lemma;
    const lemmaTarget = getLemmaInContext(targetWord, 0).lemma;

    if (!lemmaStart || !lemmaTarget) {
        throw new Error("Could not extract lemma from start or target word");
    } else if (lemmaStart === lemmaTarget) {
        throw new Error("Start and target words cannot be the same");
    }

    const [game] = await db.insert(gameTable).values({
        startWord: lemmaStart,
        targetWord: lemmaTarget,
        mode: mode,
        ...extraFieldsData
    }).returning()

    console.debug("Created game with start word:", game.startWord, "and target word:", game.targetWord, "for player ID:", playerID, "with extra fields:", extraFields);

    await joinGame(playerID, game.id, true);

    return game
}

export async function joinGame(playerId: string, gameId: string, admin: boolean = false) {

    await db.insert(gamePlayerLink).values({
        gameId: gameId,
        playerId: playerId,
        admin: admin
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
        timestamp: new Date().toISOString(),
    };

    if (side === "start") {
        await db.update(gamePlayerLink)
        .set({
            startLinks: sql`COALESCE(${gamePlayerLink.startLinks}, '[]'::jsonb) || ${JSON.stringify([newStep])}::jsonb`,
        })
        .where(and(
            eq(gamePlayerLink.gameId, gameId),
            eq(gamePlayerLink.playerId, playerId)
        ));
    } else {
        await db.update(gamePlayerLink)
        .set({
            targetLinks: sql`COALESCE(${gamePlayerLink.targetLinks}, '[]'::jsonb) || ${JSON.stringify([newStep])}::jsonb`,
        })
        .where(and(
            eq(gamePlayerLink.gameId, gameId),
            eq(gamePlayerLink.playerId, playerId)
        ));
    }

    return newStep;
}