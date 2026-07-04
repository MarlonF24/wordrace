import { db } from './db';
import { playerTable, gameTable, gamePlayerLink, type RaceStep, type Game, type GameInsert } from './schema';
import { eq, and, sql } from 'drizzle-orm';
import { cache } from 'react';

import { getWordRecord, RichToken } from '../dictionary';
import { tokenizeToRichText } from '@/lib/lemmatisation';
import { isFunctionWordToken } from '@/lib/part-of-speech';

/**
 * Create a player row for the cookie identity assigned by `proxy.ts`.
 *
 * The caller supplies the UUID so the browser cookie and database row stay
 * aligned. Existing players are expected to be loaded before this is called.
 */
export async function createPlayer(playerID: string) {
    const [player] = await db
        .insert(playerTable)
        .values({
            id: playerID,
            createdAt: new Date(),
        })
        .returning();
    return player;
}

/**
 * Load the race state for one player inside one game.
 *
 * The returned row contains both lanes and derived completion fields. It does
 * not include the joined game; route-level loaders add that when needed.
 */
export async function getGamePlayerLink(gameId: string, playerId: string) {
    return await db.query.gamePlayerLink.findFirst({
        where: {
            gameId: gameId,
            playerId: playerId,
        },
    });
}

/**
 * Validate and create a game, then join the creating player as admin.
 *
 * Start and target words are tokenized once, normalized according to the
 * lemmatization option, checked against selected dictionary fields, and rejected
 * when collide mode would start from a function-word shortcut.
 */
export async function createGame(playerID: string, gameData: GameInsert) {
    // Keep service-level checks close to the insert so server actions share the same rules.
    if (
        !gameData.sharedLexicalFields &&
        !gameData.exclusiveSenseLexicalFields &&
        !gameData.exclusiveEntryLexicalFields
    ) {
        throw new Error('At least one lexical field must be selected to create a game');
    }


    
    const startToken = tokenizeToRichText(gameData.startWord)[0];
    if (typeof startToken !== 'object') throw new Error('Could not tokenize start word');

    const targetToken = tokenizeToRichText(gameData.targetWord)[0];
    if (typeof targetToken !== 'object') throw new Error('Could not tokenize target word');


    let insertStart: string;
    let insertTarget: string;

    if (gameData.lemmatise) {
        insertStart = startToken.l;
        insertTarget = targetToken.l;        
    } else {
        insertStart = startToken.w;
        insertTarget = targetToken.w;
    }

    if (insertStart === insertTarget) {
        throw new Error('Start and target words cannot be the same');
    }

    if (gameData.mode === "collide") {
        if (isFunctionWordToken(startToken)) throw new Error(`Start Word "${startToken.w}" is a function word which are prohibited in collide mode`);
        if (isFunctionWordToken(targetToken)) throw new Error(`Target Word "${targetToken.w}" is a function word which are prohibited in collide mode`);
    }

    // Record loading validates word existence and selected-field availability before insertion.
    await Promise.all([
        getRecordForGame(gameData, insertStart),
        getRecordForGame(gameData, insertTarget),
    ]);

    const insert = gameData;

    insert.startWord = insertStart;
    insert.targetWord = insertTarget;

    const [game] = await db
        .insert(gameTable)
        .values({
            ...insert,
        })
        .returning();

    console.debug(
        'Created game with start word:',
        game.startWord,
        'and target word:',
        game.targetWord,
        'for player ID:',
        playerID,
        'with lexical fields:',
        game.lexicalFields
    );

    await joinGame(playerID, game, true);

    return game;
}

/**
 * Add a player to a game and initialize both race lanes at the game endpoints.
 *
 * Normal mode only renders the start lane, but the target lane is still
 * initialized so collide-mode and derived completion fields share one shape.
 */
export async function joinGame(playerId: string, game: Game, admin: boolean = false) {
    const time = Date.now();
    await db.insert(gamePlayerLink).values({
        gameId: game.id,
        playerId: playerId,
        admin: admin,
        startLinks: [{ word: game.startWord, timestamp: time }],
        targetLinks: [{ word: game.targetWord, timestamp: time }],
    });
}

export const getRecordForGame = cache(
    /**
     * Load the dictionary record for a word using one game's selected fields.
     *
     * React caches this per request so both collide lanes can ask for records
     * without duplicated database work when the same word appears.
     */
    async (
        game: Pick<GameInsert, 'sharedLexicalFields' | 'exclusiveSenseLexicalFields' | 'exclusiveEntryLexicalFields'>,
        word: string
    ) => {
        return getWordRecord(
            word,
            game.sharedLexicalFields,
            game.exclusiveSenseLexicalFields,
            game.exclusiveEntryLexicalFields
        );
    }
);

/**
 * Append a clicked rich token to one side of the player's race history.
 *
 * The clicked token is normalized according to the game lemmatization setting,
 * then resolved through `getRecordForGame`. That query is also the validation
 * step: invalid words or unavailable lexical fields throw before history is
 * updated.
 */
export async function addRaceStep(game: Game, playerId: string, word: RichToken, side: 'start' | 'target' = 'start') {
    const queryWord = game.lemmatise ? word.l : word.w;

    // Loading the record validates the clicked token before appending history.
    const entry = await getRecordForGame(game, queryWord);

    const newStep: RaceStep = {
        word: queryWord,
        timestamp: Date.now(),
    };

    const linkField = side === 'start' ? 'startLinks' : 'targetLinks';

    const [updatedLink] = await db
        .update(gamePlayerLink)
        .set({
            [linkField]: sql`${gamePlayerLink[linkField]} || ${JSON.stringify([newStep])}::jsonb`,
        })
        .where(and(eq(gamePlayerLink.gameId, game.id), eq(gamePlayerLink.playerId, playerId)))
        .returning();

    return { entry, newStep, found: updatedLink.found };
}
