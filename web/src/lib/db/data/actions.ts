"use server"
// server action version of the db service functions
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

export const addRaceStepAction = async (gameId: string, playerId: string, newWord: string) => {
    return await service.addRaceStep(gameId, playerId, newWord);
}