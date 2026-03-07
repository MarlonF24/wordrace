import {eq, and, sql} from "drizzle-orm";
import {db} from "./db";
import {playerTable, gameTable, gamePlayerLink, RaceStep} from "./schema";


export async function createPlayer(playerID: string) {
    
    await db.insert(playerTable).values({
        id: playerID,
        createdAt: new Date(),
    })
}

export async function createGame(playerID: string, startWord: string, targetWord: string) {
    
    const [game] = await db.insert(gameTable).values({
        startWord,
        targetWord,
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

export async function addRaceStep(gameId: string, playerId: string, newWord: string) {
  const newStep: RaceStep = {
    word: newWord,
    timestamp: new Date().toISOString(),
  };

  await db
    .update(gamePlayerLink)
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