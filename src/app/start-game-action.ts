"use server";

import { redirect } from "next/navigation";
import { DATA_DB } from "@/lib/db";
import { getPlayerId } from "@/lib/server/utils";



export const startGameAction = async (gameData: DATA_DB.CreateGameData) => {

    const playerId = await getPlayerId();
    
    // again, looks stupid but redirect throws a "NEXT_REDIRECT_ERROR" and thus cant be put into the try without extra logic, and game is unbound for some reason even if no error is thrown

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