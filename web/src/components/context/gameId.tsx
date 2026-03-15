"use client";

import { createContext, useContext } from "react";

export const GameIdContext = createContext<string | null>(null);

export function GameIdProvider({ children, value }: { children: React.ReactNode; value: string }) {
    return (
        <GameIdContext.Provider value={value}>
            {children}
        </GameIdContext.Provider>
    )
}

export function useGameId() {
    const gameId = useContext(GameIdContext);

    if (!gameId) throw new Error("useGameId must be used within a GameIdProvider");

    return gameId;
}