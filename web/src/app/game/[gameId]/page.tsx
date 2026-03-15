
import { DATA_DB } from "@/lib/db";
import { getPlayerId } from "@/lib/server/utils";
import { History } from "./history";
import { DefinitionDisplay } from "./definitionCard";
import { getSenses } from "@/lib/db/dictionary/service";


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

    let links: DATA_DB.RaceStep[] = gamePlayerLink.links ?? [];

    if (links.length == 0) {
        const firstStep = await DATA_DB.addRaceStep(game.id, gamePlayerLink.playerId, game.startWord, 0);
        links = [firstStep];
    }

    const currentWord = links[links.length - 1].word;

    const sensesPromise = getSenses(currentWord);


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

            <div className="flex-1 flex flex-col-reverse md:flex-row min-h-0 divide-y-2 divide-y-reverse md:divide-y-0 md:divide-x-2 divide-border">
                <aside className="h-48 md:h-full flex-none w-full md:w-80">
                    <History currentLinks={links} />
                </aside>
                
                <div key={currentWord} className="flex-1 min-w-0 bg-background relative overflow-y-auto">
                     <DefinitionDisplay 
                        word={currentWord} 
                        sensesPromise={sensesPromise} 
                     />
                </div>
            </div>
        </div>
    )
  
}