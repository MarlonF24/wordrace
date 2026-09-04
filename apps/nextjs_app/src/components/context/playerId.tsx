"use client";

import { createContext, useContext } from "react";
import { type InferSelectModel } from "drizzle-orm";
import { playerTable } from "@/lib/db/data";


export const PlayerIdContext = createContext<InferSelectModel<typeof playerTable> | null>(null);

export function PlayerProvider({ children, value }: { children: React.ReactNode; value: InferSelectModel<typeof playerTable> }) {
    return (
        <PlayerIdContext.Provider value={value}>
            {children}
        </PlayerIdContext.Provider>
    )
}

export function usePlayer() {
    const playerId = useContext(PlayerIdContext);

    if (!playerId) throw new Error("usePlayer must be used within a PlayerProvider");

    return playerId;
}