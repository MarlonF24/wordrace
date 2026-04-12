"use client";

import { useError } from "@/components/context";
import { AlertCircle, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEffect } from "react";

export function ErrorDisplay() {
    const { error, setError } = useError();

    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [error, setError]);

    if (!error) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 max-w-md animate-in fade-in slide-in-from-bottom-2">
            <Alert variant="destructive" className="bg-destructive text-destructive-foreground shadow-lg border-2 border-destructive-foreground/20">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle className="font-bold">Error</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-4">
                    <span>{error}</span>
                    <button 
                        onClick={() => setError(null)}
                        className="hover:bg-destructive-foreground/10 rounded-full p-1 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </AlertDescription>
            </Alert>
        </div>
    );
}
