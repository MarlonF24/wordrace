"use server"

import * as service from "./service";
import { getSenses } from "@/lib/db/dictionary/service";
import { type GameMode } from "./schema";

export const createPlayerAction = async (playerID: string) => {
    await service.createPlayer(playerID);
}

export const createGameAction = async (playerID: string, startWord: string, targetWord: string, mode: GameMode = "normal") => {
    return await service.createGame(playerID, startWord, targetWord, mode);
}

export const joinGameAction = async (playerId: string, gameId: string, admin: boolean = false) => {
    await service.joinGame(playerId, gameId, admin);
}

export async function addRaceStepAction(gameId: string, playerId: string, sentence: string, wordIdx: number, side: "start" | "target" = "start") {
    const result = await service.addRaceStep(gameId, playerId, sentence, wordIdx, side); // Correctly pass side
    const senses = await getSenses(result.word);
    return { step: result, senses };
}


    