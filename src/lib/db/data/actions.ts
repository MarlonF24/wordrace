"use server"

import * as service from "./service";
import { type InferSelectModel } from "drizzle-orm";
import { gameTable } from "./schema";

import { type RichToken } from "../dictionary/types";

export const createPlayerAction = async (playerID: string) => {
    return service.createPlayer(playerID);
}

// export const createGameAction = async (playerID: string, gameData: service.CreateGameData) => {
    // return service.createGame(playerID, gameData);
// }

// export const joinGameAction = async (playerId: string, game: InferSelectModel<typeof gameTable>, admin: boolean = false) => {
//     service.joinGame(playerId, game, admin);
// }

export async function addRaceStepAction(game: InferSelectModel<typeof gameTable>, playerId: string, token: RichToken, side: "start" | "target" = "start") {        
    return service.addRaceStep(game, playerId, token, side);
}

// export async function getGamePlayerLinkAction(gameId: string, playerId: string) {
//     return service.getGamePlayerLink(gameId, playerId);
// }
