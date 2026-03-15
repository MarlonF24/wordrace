import {db} from "./db";
import {playerTable, gameTable, gamePlayerLink, type RaceStep} from "./schema";
import { DICTIONARY_DB } from "@/lib/db";
import { getLemmaInContext } from "@/lib/lemmatisation";
import { eq, and, sql } from "drizzle-orm";


export async function createPlayer(playerID: string) {
    
    await db.insert(playerTable).values({
        id: playerID,
        createdAt: new Date(),
    })
}

export async function createGame(playerID: string, startWord: string, targetWord: string) {
    
    const [game] = await db.insert(gameTable).values({
        startWord: getLemmaInContext(startWord, 0).lemma,
        targetWord: getLemmaInContext(targetWord, 0).lemma,
    }).returning()

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


export async function  addRaceStep(gameId: string, playerId: string, sentence: string, wordIdx: number) {
    const { lemma } = getLemmaInContext(sentence, wordIdx);
    const cleanLemma = lemma.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").toLowerCase();
        
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

    // update DB
    await db.update(gamePlayerLink)
    .set({
      links: sql`COALESCE(${gamePlayerLink.links}, '[]'::jsonb) || ${JSON.stringify([newStep])}::jsonb`,
    })
    .where(and(
      eq(gamePlayerLink.gameId, gameId),
      eq(gamePlayerLink.playerId, playerId)
    )
    );

    return newStep;
}