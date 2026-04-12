"use server";

import { redirect } from "next/navigation";
import { DATA_DB } from "@/lib/db";
import { getPlayerId } from "@/lib/server/utils";
import { type GameMode } from "@/lib/db/data/schema";
import { type EXTRA_FIELDS } from "./start-game-form";

export const startGameFormAction = async (formData: FormData) => {
    const startWord = formData.get("startWord")!.toString();
    const targetWord = formData.get("targetWord")!.toString();

    const playerId = await getPlayerId();

    const mode = (formData.get("mode")?.toString() as GameMode) || "normal";
    
    const extraFields = formData.getAll("extraFields") as (keyof typeof EXTRA_FIELDS)[];
    console.debug("Selected extra fields:", extraFields);

    let gameId: string | null = null; // looks stupid but redirect throws a "NEXT_REDIRECT_ERROR" and game is unbound for some reason even if no error is thrown
    try {
        const game = await DATA_DB.createGameAction(playerId, startWord, targetWord, mode, extraFields);
        gameId = game.id;
    } catch (error) {
        console.error("Error creating game:", error);
        return { error: (error as Error).message || "An error occurred while creating the game" };
    }

    if (gameId) {
        redirect(`/game/${gameId}`);
    }
} 