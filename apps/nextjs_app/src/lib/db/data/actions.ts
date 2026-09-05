'use server';

import * as service from './service';
import { isDictionaryRecordError, type RichToken } from '../dictionary';

export type AddRaceStepActionResult =
    | { success: true }
    | { success: false; error: string };

export const createPlayerAction = async (playerID: string) => {
    return service.createPlayer(playerID);
};

export async function addRaceStepAction(
    gameId: string,
    playerId: string,
    token: RichToken,
    side: 'start' | 'target' = 'start'
): Promise<AddRaceStepActionResult> {
    try {
        await service.addRaceStep(gameId, playerId, token, side);
        return { success: true };
    } catch (error) {
        // Expected lookup failures cross the Server Action boundary as data so
        // Next.js does not replace their messages in production.
        if (isDictionaryRecordError(error)) {
            return { success: false, error: error.message };
        }
        throw error;
    }
}
