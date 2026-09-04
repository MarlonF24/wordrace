'use server';

import * as service from './service';
import { type RichToken } from '../dictionary/types';

export const createPlayerAction = async (playerID: string) => {
    return service.createPlayer(playerID);
};

export async function addRaceStepAction(
    gameId: string,
    playerId: string,
    token: RichToken,
    side: 'start' | 'target' = 'start'
) {
    return service.addRaceStep(gameId, playerId, token, side);
}
