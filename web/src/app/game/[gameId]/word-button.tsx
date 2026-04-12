"use client";

import { useTransition } from "react";
import { addRaceStepAction } from "@/lib/db/data/actions";
import { useGame, usePlayer } from "@/components/context";

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
    const [isPending, startTransition] = useTransition();
    const game = useGame();
    const player = usePlayer();

    return (
        <button
            disabled={isPending}
            onClick={() => {
                startTransition(async () => {
                    await addRaceStepAction(game, player.id, fullText, tokenIndex, side);
                });
            }}
            className="hover:underline hover:text-primary transition-colors cursor-pointer text-left inline-block disabled:opacity-50 disabled:cursor-not-allowed"
        >
            {children}
        </button>
    );
}
