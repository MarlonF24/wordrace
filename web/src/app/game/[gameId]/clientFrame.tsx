"use client"

import { type InferSelectModel } from "drizzle-orm";
import { gameTable, gamePlayerLink as link } from "@/lib/db/data/schema";
import { addRaceStepAction } from "@/lib/db/data/actions";
import { DefinitionDisplay } from "./definition";
import { History } from "./history";
import { useState, useCallback } from "react";


export function ClientFrame({
    game, 
    gamePlayerLink
}: {
    game: InferSelectModel<typeof gameTable>,
    gamePlayerLink: InferSelectModel<typeof link>
}) {
    const [linkHistory, setLinkHistory] = useState(gamePlayerLink.links);

    const addLinkToHistory = useCallback(async (newLink: string) => {
        const newStep = await addRaceStepAction(game.id, gamePlayerLink.playerId, newLink);
        setLinkHistory((prev) => [...(prev || []), newStep]);
    }, [game, gamePlayerLink])

    const currentWord = linkHistory?.length > 0 ? linkHistory[linkHistory.length - 1].word : game.startWord;

    return (
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
            <header className="flex-none bg-muted/30 border-b-2 border-border p-4 flex items-center justify-between gap-8 h-20">
                <div className="flex flex-col">
                    <span className="text-xs uppercase font-bold text-muted-foreground tracking-widest">Start Word</span>
                    <span className="text-lg font-black uppercase tracking-tight truncate max-w-[200px]" title={game.startWord}>
                        {game.startWord}
                    </span>
                </div>
                
                <div className="flex-1 h-px bg-border max-w-md mx-auto relative">
                     <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground font-mono">
                        TO
                     </span>
                </div>

                <div className="flex flex-col items-end text-right">
                    <span className="text-xs uppercase font-bold text-muted-foreground tracking-widest">Target Word</span>
                    <span className="text-lg font-black uppercase tracking-tight truncate max-w-[200px]" title={game.targetWord}>
                        {game.targetWord}
                    </span>
                </div>
            </header>

            <div className="flex-1 flex min-h-0 divide-x-2 divide-border">
                <aside className="h-full bg-secondary/10">
                    <History currentLinks={linkHistory} />
                </aside>
                
                <div className="flex-1 min-w-0 bg-background relative">
                     <DefinitionDisplay word={currentWord} addLinkToHistory={addLinkToHistory} />
                </div>
            </div>
        </div>
    )
}