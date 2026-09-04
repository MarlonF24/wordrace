"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { type RaceStep } from "@/lib/db/data";
import { type GameMode } from "@/lib/game-modes";

type RouteHintCategory = "Hot" | "Warm" | "Cool" | "Cold" | "No route" | "Offline";

type RouteHintResponse = {
    category: RouteHintCategory;
    steps: number | null;
};

const CATEGORY_STYLES: Record<RouteHintCategory, string> = {
    Hot: "bg-red-500 text-white",
    Warm: "bg-orange-400 text-white",
    Cool: "bg-sky-300 text-sky-950",
    Cold: "bg-slate-700 text-white",
    "No route": "bg-background text-foreground",
    Offline: "bg-muted text-muted-foreground",
};

/**
 * Fetch one UI-ready route hint from the internal Next.js route.
 *
 * @param gameId - Active game ID used by the server route to load player state.
 * @param signal - Abort signal owned by the calling effect.
 * @returns A route hint, mapping non-OK responses to `Offline`.
 */
async function fetchRouteHint(gameId: string, signal: AbortSignal): Promise<RouteHintResponse> {
    const response = await fetch(`/api/search-difficulty?gameId=${gameId}`, {
        cache: "no-store",
        signal,
    });

    if (!response.ok) {
        return { category: "Offline", steps: null };
    }

    return response.json() as Promise<RouteHintResponse>;
}

/**
 * Show a compact ML route estimate for the current game state.
 *
 * @param gameId - Active game ID used by the internal API route.
 * @param startStep - Current start-lane step, included to refetch after moves.
 * @param targetStep - Current target-lane step, included to refetch after collide moves.
 * @param mode - Game mode used only for accessible status text.
 */
export function RouteHintPanel({
    gameId,
    startStep,
    targetStep,
    mode,
}: {
    gameId: string;
    startStep: RaceStep;
    targetStep: RaceStep;
    mode: GameMode;
}) {
    const [hint, setHint] = useState<RouteHintResponse | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const controller = new AbortController();

        void fetchRouteHint(gameId, controller.signal)
            .then((routeHint) => setHint(routeHint))
            .catch((error) => {
                if (!controller.signal.aborted) {
                    console.error("Route hint fetch failed:", error);
                    setHint({ category: "Offline", steps: null });
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            });

        return () => controller.abort();
    }, [gameId, startStep.word, targetStep.word]);

    const category = loading ? "Searching..." : hint?.category ?? "Offline";
    const detail = hint?.steps === null || hint?.steps === undefined
        ? mode === "collide" ? "collide search" : "route search"
        : `about ${hint.steps} links`;

    return (
        <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">AI Route Hint</span>
            <Badge className={loading ? "bg-muted text-muted-foreground" : CATEGORY_STYLES[hint?.category ?? "Offline"]}>
                {category}
            </Badge>
            <span className="text-[10px] text-muted-foreground font-mono uppercase">{detail}</span>
        </div>
    );
}
