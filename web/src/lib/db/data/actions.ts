"use server"

import * as service from "./service";

export const createPlayerAction = async (playerID: string) => {
    await service.createPlayer(playerID);
}

export const createGameAction = async (playerID: string, startWord: string, targetWord: string) => {
    return await service.createGame(playerID, startWord, targetWord);
}

export const joinGameAction = async (playerId: string, gameId: string, admin: boolean = false) => {
    await service.joinGame(playerId, gameId, admin);
}

import { revalidatePath } from "next/cache";

export async function addRaceStepAction(gameId: string, playerId: string, sentence: string, wordIdx: number) {
    const result = await service.addRaceStep(gameId, playerId, sentence, wordIdx);
    revalidatePath(`/game/${gameId}`);
    return result;
}

    