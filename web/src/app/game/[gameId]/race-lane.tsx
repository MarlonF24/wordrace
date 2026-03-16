"use client"

import { useState } from "react";
import { type RaceStep } from "@/lib/db/data";
import { type getSenses } from "@/lib/db/dictionary/service";
import { History } from "./history";
import { DefinitionDisplay } from "./definitionCard";
import { addRaceStepAction } from "@/lib/db/data/actions";
import { useGameId, usePlayerId } from "@/components/context";

export function RaceLane({
    initialLinks,
    initialSenses,
    side,
    isMirrored = false
}: {
    initialLinks: RaceStep[];
    initialSenses: Awaited<ReturnType<typeof getSenses>>;
    side: "start" | "target";
    isMirrored?: boolean;
}) {
    const gameId = useGameId();
    const playerId = usePlayerId();
    const [links, setLinks] = useState(initialLinks);
    const [senses, setSenses] = useState(initialSenses);
    
    // Fallback if links are somehow empty, though they shouldn't be given page logic
    const lastWord = links[links.length - 1]?.word;

    const handleWordClick = async (sentence: string, wordIdx: number) => {
        const result = await addRaceStepAction(gameId, playerId, sentence, wordIdx, side);
        setLinks(prev => [...prev, result.step]);
        setSenses(result.senses);
    };

    const historyComponent = (
        <aside className="hidden xl:block w-48 h-full overflow-hidden flex-none">
            <History 
                currentLinks={links} 
                className={isMirrored ? "border-l-2 border-r-0 rounded-none h-full" : "border-r-2 border-l-0 rounded-none h-full"} 
            />
        </aside>
    );

    const definitionComponent = (
        <div key={lastWord} className="flex-1 min-w-0 bg-background relative overflow-hidden flex flex-col h-full">
             <DefinitionDisplay 
                word={lastWord} 
                senses={senses} 
                onWordClick={handleWordClick}
             />
        </div>
    );

    return (
        <div className="flex flex-row h-full w-full overflow-hidden">
            {isMirrored ? (
                <>
                    {definitionComponent}
                    {historyComponent}
                </>
            ) : (
                 <>
                    {historyComponent}
                    {definitionComponent}
                </>
            )}
        </div>
    );
}
