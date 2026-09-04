"use client";

import { addRaceStepAction } from "@/lib/db/data/actions";
import { useGame, usePlayer, useError, usePending } from "@/components/context";
import { type RichText, type RichToken } from "@/lib/db/dictionary/types";

/**
 * Render rich text as literal strings plus clickable word tokens.
 *
 * The game's Wink POS availability applies uniformly to prose and explicit
 * lexical fields.
 */
export function RichTextRenderer({
    tokens,
    side,
}: {
    tokens: RichText;
    side: "start" | "target";
}) {
    const game = useGame();

    return (
        <>
            {tokens.map((token, index) => {
                const displayString = typeof token === "string" ? token : token.w;

                if (typeof token === "string" || !game.availablePos[token.p]) {
                    return (
                        <span key={index} className="whitespace-pre-wrap">
                            {displayString}
                        </span>
                    );
                }

                return (
                    <WordButton key={index} token={token} side={side}>
                        {displayString}
                    </WordButton>
                );
            })}
        </>
    );
}

/**
 * Submit one clicked rich token as the next race step.
 *
 * The server action normalizes the token according to game settings and returns
 * an error when the target word is invalid for the selected lexical fields.
 */
export function WordButton({
    token,
    children,
    side,
}: {
    token: RichToken;
    children: React.ReactNode;
    side: "start" | "target";
}) {
    const game = useGame();
    const player = usePlayer();
    const { isPending, startTransition } = usePending();
    const { setError } = useError();

    return (
        <button
            disabled={isPending}
            onClick={() => {
                setError(null);
                startTransition(async () => {
                    try {
                        await addRaceStepAction(game.id, player.id, token, side);
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
