"use server";

import { redirect } from "next/navigation";
import { DATA_DB } from "@/lib/db";
import { getPlayerId } from "@/lib/server/utils";
import { type SelectableLexicalKey} from "@/lib/db/dictionary/types";


export const startGameAction = async (
    startWord: string, 
    targetWord: string, 
    mode: DATA_DB.GameMode, 
    lexicalFields: Partial<Record<SelectableLexicalKey, boolean>>
) => {
    if (Object.keys(lexicalFields).length === 0) {
        return { error: "At least one lexical field must be selected" };
    }

    const playerId = await getPlayerId();
    
    // again, looks stupid but redirect throws a "NEXT_REDIRECT_ERROR" and thus cant be put into the try without game logic, and game is unbound for some reason even if no error is thrown

    let gameId: string;
    
    try {
        const game = await DATA_DB.createGame(playerId, startWord, targetWord, mode, lexicalFields);
        gameId = game.id;
    } catch (error) {
        console.error("Error creating game:", error);
        return { error: (error as Error).message || "An error occurred while creating the game" };
    }

    redirect(`/game/${gameId}`);
} 