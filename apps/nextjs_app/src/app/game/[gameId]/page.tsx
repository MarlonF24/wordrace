import { DATA_DB } from '@/lib/db';
import { getPlayerId } from '@/lib/server/utils';
import { RaceLane } from './race-lane';
import { RaceStep, getRecordForGame } from '@/lib/db/data';
import { type WordRecord } from '@/lib/db/dictionary';
import { FoundPopup } from './foundPopup';
import { ErrorDisplay } from './error-display';
import { RouteHintPanel } from './route-hint-panel';

/**
 * Render the active game for the current player.
 *
 * This loader owns the player/game link query, current dictionary-record loads,
 * and the normal-vs-collide layout decision.
 */
export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
    const { gameId } = await params;
    const playerId = await getPlayerId();

    const result = await DATA_DB.db.query.gamePlayerLink.findFirst({
        where: { gameId, playerId },
        with: {
            game: true,
        },
    });

    if (!result || !result.game) {
        throw new Error('Game or player link not found');
    }

    const { game, ...gamePlayerLink } = result;

    const startLinks: DATA_DB.RaceStep[] = gamePlayerLink.startLinks;

    if (startLinks.length === 0) {
        throw new Error('Start links should have been initialized on joinGame, found empty');
    }

    const targetLinks: DATA_DB.RaceStep[] = gamePlayerLink.targetLinks;
    if (targetLinks.length === 0) {
        throw new Error('Target links should have been initialized on joinGame for collide mode, found empty');
    }

    const currStartStep = startLinks[startLinks.length - 1];
    const currTargetStep = targetLinks[targetLinks.length - 1];
    const currStartWord = currStartStep.word;

    const startRecordPromise = getRecordForGame(game, currStartWord);

    let raceLanes;

    if (game.mode === 'collide') {
        const targetWord = currTargetStep.word;

        const targetRecordPromise = getRecordForGame(game, targetWord);

        const [startRecord, targetRecord] = await Promise.all([startRecordPromise, targetRecordPromise]);

        raceLanes = (
            <DoubleLane
                startLinks={startLinks}
                targetLinks={targetLinks}
                startRecord={startRecord}
                targetRecord={targetRecord}
            />
        );
    } else {
        const startRecord = await startRecordPromise;

        raceLanes = (
            <div className="w-full h-full">
                <RaceLane
                    links={startLinks}
                    record={startRecord}
                    side={'start'}
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
            <ErrorDisplay />
            {gamePlayerLink.found && <FoundPopup game={game} gamePlayerLink={gamePlayerLink} />}
            <header className="flex-none bg-muted/30 border-b-2 border-border p-4 flex items-center justify-between gap-8 h-20">
                <div className="flex flex-col">
                    <span className="text-xs uppercase font-bold text-muted-foreground tracking-widest">
                        Start Word
                    </span>
                    <span
                        className="text-lg font-black uppercase tracking-tight truncate max-w-[200px]"
                        title={game.startWord}
                    >
                        {game.startWord}
                    </span>
                </div>

                <div className="flex-1 h-px bg-border max-w-md mx-auto relative hidden md:block">
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground font-mono uppercase">
                        {game.mode === 'collide' ? 'COLLIDE' : 'TO'}
                    </span>
                </div>

                {game.aiHintsEnabled && (
                    <RouteHintPanel
                        key={`${currStartStep.word}:${currTargetStep.word}`}
                        gameId={game.id}    
                        startStep={currStartStep}
                        targetStep={currTargetStep}
                        mode={game.mode}
                    />
                )}

                <div className="flex flex-col items-end text-right">
                    <span className="text-xs uppercase font-bold text-muted-foreground tracking-widest">
                        Target Word
                    </span>
                    <span
                        className="text-lg font-black uppercase tracking-tight truncate max-w-[200px]"
                        title={game.targetWord}
                    >
                        {game.targetWord}
                    </span>
                </div>
            </header>

            <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">{raceLanes}</div>
        </div>
    );
}

/**
 * Render collide mode as two independent lanes that meet when their histories share a word.
 */
const DoubleLane = ({
    startLinks,
    targetLinks,
    startRecord,
    targetRecord,
}: {
    startLinks: RaceStep[];
    targetLinks: RaceStep[];
    startRecord: WordRecord;
    targetRecord: WordRecord;
}) => {
    return (
        <>
            <div className="flex-1 min-w-0 border-r-2 border-border relative">
                <div className="absolute inset-0">
                    <RaceLane
                        links={startLinks}
                        record={startRecord}
                        side="start"
                    />
                </div>
            </div>
            <div className="flex-1 min-w-0 relative">
                <div className="absolute inset-0">
                    <RaceLane
                        links={targetLinks}
                        record={targetRecord}
                        side="target"
                    />
                </div>
            </div>

            {/* Mobile Collide Indicator/Separator */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-border z-10 md:hidden pointer-events-none"></div>
        </>
    );
};
