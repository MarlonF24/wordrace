"use server"

import * as service from "./service";
import { type GameMode, type SelectableExtraKey as ExtraField } from "./schema";
import { InferSelectModel } from "drizzle-orm";
import { gameTable } from "./schema";

export const createPlayerAction = async (playerID: string) => {
    return service.createPlayer(playerID);
}

export const createGameAction = async (playerID: string, startWord: string, targetWord: string, mode: GameMode = "normal", extraFields: ExtraField[] = []) => {
    return service.createGame(playerID, startWord, targetWord, mode, extraFields);
}

export const joinGameAction = async (playerId: string, gameId: string, admin: boolean = false) => {
    service.joinGame(playerId, gameId, admin);
}

export async function addRaceStepAction(game: InferSelectModel<typeof gameTable>, playerId: string, sentence: string, wordIdx: number, side: "start" | "target" = "start") {

    const result = await service.addRaceStep(game.id, playerId, sentence, wordIdx, side);

    const entries = await service.getEntriesForGame(game, result.word);
    return { step: result, entries };
}


    