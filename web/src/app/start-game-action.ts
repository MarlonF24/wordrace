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

    const game = await DATA_DB.createGameAction(playerId, startWord, targetWord, mode, extraFields);

    redirect(`/game/${game.id}`);
} 