
import { DATA_DB } from "@/lib/db";
import { getPlayerId } from "@/lib/server/utils";
import { getSenses } from "@/lib/db/dictionary/service";
import { RaceLane } from "./race-lane";


export default async function GamePage({
    params,
}: {
    params: Promise<{ gameId: string }>
}) {
    const { gameId } = await params;
    const playerId = await getPlayerId();

    const [game, gamePlayerLink] = await Promise.all([
        DATA_DB.db.query.gameTable.findFirst({
            where: { id: gameId }
        }),
        DATA_DB.db.query.gamePlayerLink.findFirst({
            where: { gameId, playerId }
        })
    ]);

    if (!game || !gamePlayerLink) {
        throw new Error("Game or player link not found");
    }

    // Initialize start links if empty
    let startLinks: DATA_DB.RaceStep[] = gamePlayerLink.startLinks ?? [];
    if (startLinks.length === 0) {
        const firstStep = await DATA_DB.addRaceStep(game.id, gamePlayerLink.playerId, game.startWord, 0, "start");
        startLinks = [firstStep];
    }

    // Initialize target links if collide mode and empty
    let targetLinks: DATA_DB.RaceStep[] = gamePlayerLink.targetLinks ?? [];
    if (game.mode === "collide" && targetLinks.length === 0) {
        const firstStep = await DATA_DB.addRaceStep(game.id, gamePlayerLink.playerId, game.targetWord, 0, "target");
        targetLinks = [firstStep];
    }

    const startWord = startLinks[startLinks.length - 1].word;
    const startSensesPromise = getSenses(startWord);
    
    // We intentionally ignore type mismatch for non-collide mode as it won't be used
    // But to satisfy TS, we can just promise resolve empty array casted correctly
    const targetWord = targetLinks.length > 0 ? targetLinks[targetLinks.length - 1].word : "";
    const targetSensesPromise = game.mode === "collide" && targetWord 
        ? getSenses(targetWord) 
        : Promise.resolve([]);

    const [startSenses, targetSenses] = await Promise.all([startSensesPromise, targetSensesPromise]);


    return (
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
            <header className="flex-none bg-muted/30 border-b-2 border-border p-4 flex items-center justify-between gap-8 h-20">
                <div className="flex flex-col">
                    <span className="text-xs uppercase font-bold text-muted-foreground tracking-widest">Start Word</span>
                    <span className="text-lg font-black uppercase tracking-tight truncate max-w-[200px]" title={game.startWord}>
                        {game.startWord}
                    </span>
                </div>
                
                <div className="flex-1 h-px bg-border max-w-md mx-auto relative hidden md:block">
                     <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground font-mono uppercase">
                        {game.mode === "collide" ? "COLLIDE" : "TO"}
                     </span>
                </div>

                <div className="flex flex-col items-end text-right">
                    <span className="text-xs uppercase font-bold text-muted-foreground tracking-widest">Target Word</span>
                    <span className="text-lg font-black uppercase tracking-tight truncate max-w-[200px]" title={game.targetWord}>
                        {game.targetWord}
                    </span>
                </div>
            </header>

            <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
                {game.mode === "collide" ? (
                    <>
                        <div className="flex-1 min-w-0 border-r-2 border-border relative">
                             <div className="absolute inset-0">
                                <RaceLane 
                                    initialLinks={startLinks}
                                    initialSenses={startSenses}
                                    side="start"
                                    isMirrored={false}
                                />
                             </div>
                        </div>
                        <div className="flex-1 min-w-0 relative">
                            <div className="absolute inset-0">
                                <RaceLane 
                                    initialLinks={targetLinks}
                                    initialSenses={targetSenses}
                                    side="target"
                                    isMirrored={true}
                                />
                            </div>
                        </div>
                        
                        {/* Mobile Collide Indicator/Separator */}
                        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-border z-10 md:hidden pointer-events-none"></div>
                    </>
                ) : (
                    <div className="w-full h-full">
                         <RaceLane 
                            initialLinks={startLinks}
                            initialSenses={startSenses}
                            side="start"
                            isMirrored={false}
                        />
                    </div>
                )}
            </div>
        </div>
    )
  
}