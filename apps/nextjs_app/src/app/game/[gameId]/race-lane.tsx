import { type RaceStep } from "@/lib/db/data";
import { History } from "./history";
import { RecordDisplay } from "./recordDisplay";
import { type WordRecord } from "@/lib/db/dictionary/types";

/**
 * Render one playable side of a race.
 *
 * A lane always has a history and a current dictionary record. Collide mode
 * renders two lanes with opposite `side` values.
 */
export function RaceLane({
    links,
    record,
    side,
}: {
    links: RaceStep[];
    record: WordRecord;
    side: "start" | "target";
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
             <RecordDisplay 
                word={lastWord} 
                record={record} 
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
