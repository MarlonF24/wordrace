"use server";

import { DATA_DB } from "@/lib/db";


export async function createPlayer(playerID: string) {
    
    await DATA_DB.db.insert(DATA_DB.playerTable).values({
        id: playerID,
        createdAt: new Date(),
    })
}


export async function createGame(playerID: string, startWord: string, targetWord: string) {
    
    const [game] = await DATA_DB.db.insert(DATA_DB.gameTable).values({
        startWord,
        targetWord,
    }).returning()

    await joinGame(playerID, game.id);

    return game
}

export async function joinGame(playerId: string, gameId: string) {

    await DATA_DB.db.insert(DATA_DB.gamePlayerLink).values({
        gameId: gameId,
        playerId: playerId,
    })
}