"use client";

import { createContext, useContext } from "react";
import { gameTable } from "@/lib/db/data";
import { type InferSelectModel } from "drizzle-orm";

export const GameIdContext = createContext<InferSelectModel<typeof gameTable> | null>(null);

export function GameProvider({ children, value }: { children: React.ReactNode; value: InferSelectModel<typeof gameTable> }) {
    return (
        <GameIdContext.Provider value={value}>
            {children}
        </GameIdContext.Provider>
    )
}

export function useGame() {
    const gameId = useContext(GameIdContext);

    if (!gameId) throw new Error("useGame must be used within a GameProvider");

    return gameId;
}