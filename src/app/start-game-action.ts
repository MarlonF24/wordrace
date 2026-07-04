"use server";

import { redirect } from "next/navigation";
import { DATA_DB } from "@/lib/db";
import { getPlayerId } from "@/lib/server/utils";

/**
 * Create a game from the submitted form state and redirect into the game route.
 *
 * `redirect` throws internally in Next.js, so game creation is isolated from the
 * redirect call. Creation errors are returned to the client form as plain state.
 */
export const startGameAction = async (
    gameData: DATA_DB.GameInsert,
) => {
    const playerId = await getPlayerId();
    
    let gameId: string;
    
    try {
        const game = await DATA_DB.createGame(playerId, gameData);
        gameId = game.id;
    } catch (error) {
        console.error("Error creating game:", error);
        return { error: (error as Error).message || "An error occurred while creating the game" };
    }

    redirect(`/game/${gameId}`);
} 
