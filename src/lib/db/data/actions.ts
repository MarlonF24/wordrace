"use server"

import * as service from "./service";
import { type InferSelectModel } from "drizzle-orm";
import { gameTable } from "./schema";

export const createPlayerAction = async (playerID: string) => {
    return await service.createPlayer(playerID);
}

export const createGameAction = async (playerID: string, gameData: service.CreateGameData) => {
    return await service.createGame(playerID, gameData);
}

export const joinGameAction = async (playerId: string, game: InferSelectModel<typeof gameTable>, admin: boolean = false) => {
    await service.joinGame(playerId, game, admin);
}

export async function addRaceStepAction(game: InferSelectModel<typeof gameTable>, playerId: string, sentence: string, wordIdx: number, side: "start" | "target" = "start") {
    try {
        const result = await service.addRaceStep(game.id, playerId, sentence, wordIdx, side);

        const entries = await service.getEntriesForGame(game, result.newStep.word);
        
        return { entries, ...result };
    } catch (e) {
        return { error: e instanceof Error ? e.message : "An unexpected error occurred." };
    }
}

export async function getGamePlayerLinkAction(gameId: string, playerId: string) {
    return await service.getGamePlayerLink(gameId, playerId);
}

export async function sameGameAction(game: InferSelectModel<typeof gameTable>, playerId: string) {


}