"use client";

import { addRaceStepAction } from "@/lib/db/data/actions";
import { useGame, usePlayer, useError, usePending } from "@/components/context";

export function WordButton({ 
    fullText, 
    tokenIndex, 
    children, 
    side 
}: { 
    fullText: string; 
    tokenIndex: number; 
    children: React.ReactNode;
    side: "start" | "target";
}) {
    const { isPending, startTransition } = usePending();
    const game = useGame();
    const player = usePlayer();
    const { setError } = useError();

    return (
        <button
            disabled={isPending}
            onClick={() => {
                setError(null);
                startTransition(async () => {
                    try {
                        const result = await addRaceStepAction(game, player.id, fullText, tokenIndex, side);
                        if (result?.error) {
                            setError(result.error);
                        }
                    } catch (e) {
                        setError(e instanceof Error ? e.message : "An unexpected error occurred.");
                    }
                });
            }}
            className="hover:underline hover:text-primary transition-colors cursor-pointer text-left inline-block disabled:opacity-50"
        >
            {children}
        </button>
    );
}
