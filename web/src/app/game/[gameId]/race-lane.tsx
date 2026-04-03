"use client"

import { useState, useCallback } from "react";
import { type RaceStep } from "@/lib/db/data";
import { History } from "./history";
import { EntriesDisplay } from "./entriesDisplay";
import { addRaceStepAction } from "@/lib/db/data/actions";
import { useGame, usePlayer } from "@/components/context";

import { type SelectableEntriesReturn } from "@/lib/db/data/schema";



export function RaceLane({
    initialLinks,
    initialEntries,
    side,
    isMirrored = false
}: {
    initialLinks: RaceStep[];
    initialEntries: SelectableEntriesReturn;
    side: "start" | "target";
    isMirrored?: boolean;
}) {
    const game = useGame();
    const player = usePlayer();
    const [links, setLinks] = useState(initialLinks);
    const [entries, setEntries] = useState(initialEntries);
    
    const lastWord = links.at(-1)?.word;

    if (!lastWord) throw new Error("Links should always have at least one step with a word");

    const handleWordClick = useCallback(async (sentence: string, wordIdx: number) => {
        const { step, entries } = await addRaceStepAction(game, player.id, sentence, wordIdx, side);

        setLinks(prev => [...prev, step]); // addRaceStepAction returns the lemmatised word that was actually added
        setEntries(entries);
    }, [game, player.id, side]);

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
             <EntriesDisplay 
                word={lastWord} 
                entries={entries} 
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
