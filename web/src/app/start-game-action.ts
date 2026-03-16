"use server";

import { redirect } from "next/navigation";
import { DATA_DB } from "@/lib/db";
import { getPlayerId } from "@/lib/server/utils";
import { type GameMode } from "@/lib/db/data/schema";


export const startGameFormAction = async (formData: FormData) => {
    const startWord = formData.get("startWord")!.toString();
    const targetWord = formData.get("targetWord")!.toString();

    const playerId = await getPlayerId();

    const mode = (formData.get("mode")?.toString() as GameMode) || "normal";
    
    const game = await DATA_DB.createGameAction(playerId, startWord, targetWord, mode);

    redirect(`/game/${game.id}`);
} 