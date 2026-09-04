import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
    searchCollide,
    searchRegular,
    type SearchRequest,
} from "@/api-clients/search_agent";
import { DATA_DB } from "@/lib/db";
import { setLikeToArray } from "@/lib/db/data";

type RouteHintCategory = "Hot" | "Warm" | "Cool" | "Cold" | "No route" | "Offline";

type SearchDifficultyResponse = {
    category: RouteHintCategory;
    steps: number | null;
};

type MlSearchOutcome =
    | { kind: "reachable"; steps: number }
    | { kind: "no-route" }
    | { kind: "offline" };

const ML_SEARCH_TIMEOUT_MS = 8_000;



/**
 * Convert an ML path length into the compact temperature label used by the UI.
 *
 * @param steps - Estimated number of links between the current lane words.
 * @returns The user-facing route difficulty category.
 */
function categoryForSteps(steps: number): RouteHintCategory {
    if (steps <= 2) return "Hot";
    if (steps <= 4) return "Warm";
    if (steps <= 7) return "Cool";
    return "Cold";
}



/**
 * Execute the mode-specific ML operation and normalize transport outcomes.
 *
 * @param mode - Current game mode.
 * @param payload - Search request derived from persisted game state.
 * @returns A reachable link count, a valid no-route outcome, or offline state.
 */
async function searchRoute(
    mode: "normal" | "collide",
    payload: SearchRequest
): Promise<MlSearchOutcome> {
    const signal = AbortSignal.timeout(ML_SEARCH_TIMEOUT_MS);

    try {
        if (mode === "collide") {
            const result = await searchCollide({ body: payload, signal });
            if (result.response?.status === 404) return { kind: "no-route" };
            if (!result.data) return { kind: "offline" };

            return {
                kind: "reachable",
                steps: result.data.start_path.length + result.data.target_path.length - 2,
            };
        }

        const result = await searchRegular({ body: payload, signal });
        if (result.response?.status === 404) return { kind: "no-route" };
        if (!result.data) return { kind: "offline" };

        return {
            kind: "reachable",
            steps: result.data.start_path.length - 1,
        };
    } catch (error) {
        console.error("ML search failed:", error);
        return { kind: "offline" };
    }
}

/**
 * Return a route hint for the authenticated player's current game state.
 *
 * The browser never contacts search_agent directly. This route verifies the
 * player-game link, derives every search constraint from persisted rules and
 * histories, and exposes only the compact status needed by the hint panel.
 */
export async function GET(
    request: NextRequest
): Promise<NextResponse<SearchDifficultyResponse>> {
    const gameId = request.nextUrl.searchParams.get("gameId");
    if (!gameId) {
        return NextResponse.json(
            { category: "Offline", steps: null },
            { status: 400 }
        );
    }

    const playerId = (await cookies()).get("playerId")?.value;
    if (!playerId) {
        return NextResponse.json(
            { category: "Offline", steps: null },
            { status: 401 }
        );
    }

    const link = await DATA_DB.db.query.gamePlayerLink.findFirst({
        where: { gameId, playerId },
        with: { game: true },
    });

    const game = link?.game;
    
    if (!game) {
        return NextResponse.json(
            { category: "Offline", steps: null },
            { status: 404 }
        );
    }

    const startStep = link.startLinks.at(-1);
    const targetStep = link.targetLinks.at(-1);
    if (!startStep || !targetStep) {
        return NextResponse.json(
            { category: "Offline", steps: null },
            { status: 409 }
        );
    }


    const payload: SearchRequest = {
        start: startStep.word,
        target: targetStep.word,
        constraints: {
            lemmatized: game.lemmatise,
            available_lexical_fields: setLikeToArray(game.lexicalFields),
            available_pos: setLikeToArray(game.availablePos),
        },
    };
    const outcome = await searchRoute(game.mode, payload);

    if (outcome.kind === "reachable") {
        return NextResponse.json({
            category: categoryForSteps(outcome.steps),
            steps: outcome.steps,
        });
    }
    if (outcome.kind === "no-route") {
        return NextResponse.json({ category: "No route", steps: null });
    }
    return NextResponse.json({ category: "Offline", steps: null });
}
