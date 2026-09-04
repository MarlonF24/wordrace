import { db } from './db';
import {
    playerTable,
    gameTable,
    gamePlayerLink,
    type RaceStep,
    type Game,
    type GameInsert,
    type SetLike,
} from './schema';
import type { GameMode } from '@/lib/game-modes';
import { eq, and, sql } from 'drizzle-orm';
import { cache } from 'react';

import { getWordRecord, type RichToken } from '../dictionary';
import { tokenizeToRichText } from '@/lib/lemmatisation';
import { WINK_POS_TAGS, type WinkPosTag } from '@/lib/part-of-speech';

const COLLIDE_FORBIDDEN_POS: ReadonlySet<WinkPosTag> = new Set([
    'ADP',
    'AUX',
    'CCONJ',
    'DET',
    'PART',
    'PRON',
    'SCONJ',
]);

/**
 * Convert an ordered tag collection into the JSONB set shape persisted on games.
 */
function posSet(tags: readonly WinkPosTag[]): SetLike<WinkPosTag> {
    const result: SetLike<WinkPosTag> = {};
    for (const tag of tags) {
        result[tag] = true;
    }
    return result;
}

const AVAILABLE_POS_BY_MODE: Record<GameMode, SetLike<WinkPosTag>> = {
    normal: posSet(WINK_POS_TAGS),
    collide: posSet(WINK_POS_TAGS.filter((tag) => !COLLIDE_FORBIDDEN_POS.has(tag))),
};

/**
 * Ensure both immutable lane roots satisfy the selected game's POS rules.
 */
function assertAvailableRootTokens(
    mode: GameMode,
    availablePos: SetLike<WinkPosTag>,
    startToken: RichToken,
    targetToken: RichToken
): void {
    for (const [label, token] of [
        ['start', startToken],
        ['target', targetToken],
    ] as const) {
        if (!availablePos[token.p]) {
            throw new Error(
                `${label} word "${token.w}" has unavailable POS "${token.p}" for ${mode} mode`
            );
        }
    }
}

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
    return db.query.gamePlayerLink.findFirst({
        where: {
            gameId,
            playerId,
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
    const selectedFieldCount =
        Object.keys(gameData.sharedLexicalFields ?? {}).length +
        Object.keys(gameData.exclusiveSenseLexicalFields ?? {}).length +
        Object.keys(gameData.exclusiveEntryLexicalFields ?? {}).length;
    if (selectedFieldCount === 0) {
        throw new Error('At least one lexical field must be selected to create a game');
    }

    const mode = gameData.mode ?? 'normal';
    const availablePos = AVAILABLE_POS_BY_MODE[mode];
    const startToken = tokenizeToRichText(gameData.startWord)[0];
    if (typeof startToken !== 'object') throw new Error('Could not tokenize start word');

    const targetToken = tokenizeToRichText(gameData.targetWord)[0];
    if (typeof targetToken !== 'object') throw new Error('Could not tokenize target word');

    const insertStart = gameData.lemmatise ? startToken.l : startToken.w;
    const insertTarget = gameData.lemmatise ? targetToken.l : targetToken.w;

    if (insertStart === insertTarget) {
        throw new Error('Start and target words cannot be the same');
    }

    // Both roots are persisted race steps and must satisfy the same click rule.
    assertAvailableRootTokens(mode, availablePos, startToken, targetToken);

    // Record loading validates word existence and selected-field availability before insertion.
    await Promise.all([
        getRecordForGame(gameData, insertStart),
        getRecordForGame(gameData, insertTarget),
    ]);

    const insert: GameInsert = {
        ...gameData,
        startWord: insertStart,
        targetWord: insertTarget,
        mode,
        availablePos,
    };

    const [game] = await db
        .insert(gameTable)
        .values(insert)
        .returning();

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
export async function addRaceStep(
    gameId: string,
    playerId: string,
    word: RichToken,
    side: 'start' | 'target' = 'start'
) {
    const game = await db.query.gameTable.findFirst({
        where: {
            id: gameId,
        },
    });
    if (!game) {
        throw new Error('Game not found');
    }

    if (!game.availablePos[word.p]) {
        throw new Error(`POS "${word.p}" is unavailable in this game`);
    }

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
        .where(and(eq(gamePlayerLink.gameId, gameId), eq(gamePlayerLink.playerId, playerId)))
        .returning();

    return { entry, newStep, found: updatedLink.found };
}
