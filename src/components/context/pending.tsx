"use client";

import { createContext, useContext, ReactNode, useTransition, TransitionStartFunction } from "react";

type PendingContextType = {
    isPending: boolean;
    startTransition: TransitionStartFunction;
};

const PendingContext = createContext<PendingContextType | undefined>(undefined);

export function PendingProvider({ children }: { children: ReactNode }) {
    const [isPending, startTransition] = useTransition();

    return (
        <PendingContext.Provider value={{ isPending, startTransition }}>
            {children}
            {isPending && (
            <div className="absolute top-4 right-4 z-50 animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
            )}
        </PendingContext.Provider>
    );
}

export function usePending() {
    const context = useContext(PendingContext);
    if (context === undefined) {
        throw new Error("usePending must be used within a PendingProvider");
    }
    return context;
}
