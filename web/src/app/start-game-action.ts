"use server";

import { redirect } from "next/navigation";
import { DATA_DB } from "@/lib/db";
import { getPlayerId } from "@/lib/server/utils";



export const startGameFormAction = async (prevState: unknown, formData: FormData) => {
    const startWord = formData.get("startWord")!.toString();
    const targetWord = formData.get("targetWord")!.toString();

    const playerId = await getPlayerId();

    console.debug("Starting game with start word:", startWord, "and target word:", targetWord, "for player ID:", playerId);

    const game = await DATA_DB.createGame(playerId, startWord, targetWord);

    redirect(`/game/${game.id}`);
} 