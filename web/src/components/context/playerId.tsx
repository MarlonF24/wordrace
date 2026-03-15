"use client";

import { createContext, useContext } from "react";

export const PlayerIdContext = createContext<string | null>(null);

export function PlayerIdProvider({ children, value }: { children: React.ReactNode; value: string }) {
    return (
        <PlayerIdContext.Provider value={value}>
            {children}
        </PlayerIdContext.Provider>
    )
}

export function usePlayerId() {
    const playerId = useContext(PlayerIdContext);

    if (!playerId) throw new Error("usePlayerId must be used within a PlayerIdProvider");

    return playerId;
}