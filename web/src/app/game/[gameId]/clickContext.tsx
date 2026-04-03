"use client";

import { createContext, useContext, ReactNode } from "react";

type ClickContextType = {
    onWordClick: (sentence: string, index: number) => void;
};

const ClickContext = createContext<ClickContextType | null>(null);

export function ClickContextProvider({
    children,
    onWordClick,
}: {
    children: ReactNode;
    onWordClick: (sentence: string, index: number) => void;
}) {
    return (
        <ClickContext.Provider value={{ onWordClick }}>
            {children}
        </ClickContext.Provider>
    );
}

export function useClickContext() {
    const context = useContext(ClickContext);
    if (!context) {
        throw new Error("useClickContext must be used within a ClickContextProvider");
    }
    return context;
}
