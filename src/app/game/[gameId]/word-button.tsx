"use client";

import { addRaceStepAction } from "@/lib/db/data/actions";
import { useGame, usePlayer, useError, usePending } from "@/components/context";
import { type RichToken } from "@/lib/db/dictionary/types";

/**
 * Submit one clicked rich token as the next race step.
 *
 * The server action normalizes the token according to game settings and returns
 * an error when the target word is invalid for the selected lexical fields.
 */
export function WordButton({ 
    token, 
    children, 
    side 
}: { 
    token: RichToken;
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
                        await addRaceStepAction(game, player.id, token, side);
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
