import { type RaceStep } from "@/lib/db/data";
import { History } from "./history";
import { EntriesDisplay } from "./entriesDisplay";
import { type SelectableEntriesReturn } from "@/lib/db/data/schema";

export function RaceLane({
    links,
    entries,
    side
}: {
    links: RaceStep[];
    entries: SelectableEntriesReturn;
    side: "start" | "target";
    isMirrored?: boolean;
}) {
    const lastWord = links.at(-1)?.word;

    if (!lastWord) throw new Error("Links should always have at least one step with a word");

    const historyComponent = (
        <aside className="hidden xl:block w-48 h-full overflow-hidden flex-none">
            <History 
                currentLinks={links} 
                className={side === "target" ? "border-l-2 border-r-0 rounded-none h-full" : "border-r-2 border-l-0 rounded-none h-full"} 
            />
        </aside>
    );

    const definitionComponent = (
        <div key={lastWord} className="flex-1 min-w-0 bg-background relative overflow-hidden flex flex-col h-full">
             <EntriesDisplay 
                word={lastWord} 
                entries={entries} 
                side={side}
             />
        </div>
    );

    return (
        <div className="flex flex-row h-full w-full overflow-hidden">
            {side === "start" ? (
                <>
                    {historyComponent}
                    {definitionComponent}
                </>
            ) : (
                 <>
                    {definitionComponent}
                    {historyComponent}
                </>
            )}
        </div>
    );
}
