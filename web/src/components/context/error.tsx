"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type ErrorContextType = {
    error: string | null;
    setError: (error: string | null) => void;
};

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export function ErrorProvider({ children }: { children: ReactNode }) {
    const [error, setError] = useState<string | null>(null);

    return (
        <ErrorContext.Provider value={{ error, setError }}>
            {children}
        </ErrorContext.Provider>
    );
}

export function useError() {
    const context = useContext(ErrorContext);
    if (context === undefined) {
        throw new Error("useError must be used within an ErrorProvider");
    }
    return context;
}


