import { db } from './db';
import { playerTable, gameTable, gamePlayerLink, type RaceStep, type Game, type GameMode } from './schema';
import { DICTIONARY_DB } from '@/lib/db';
import { eq, and, sql, InferInsertModel } from 'drizzle-orm';

import { type InferSelectModel } from 'drizzle-orm';

import {
    getDictionaryEntries,
    SELECTABLE_SHARED_LEXICAL_KEYS,
    SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS,
    SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS,
    RichToken,
    SelectableLexicalKey,
} from '../dictionary';
import { tokenizeToRichText } from '@/lib/lemmatisation';

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

export async function getGamePlayerLink(gameId: string, playerId: string) {
    return await db.query.gamePlayerLink.findFirst({
        where: {
            gameId: gameId,
            playerId: playerId,
        },
    });
}

export type CreateGameData = Omit<InferInsertModel<typeof gameTable>, 'id' | 'createdAt'>;

export async function createGame(
    playerID: string, 
    startWord: string, 
    targetWord: string, 
    mode: GameMode, 
    lexicalFields: Partial<Record<SelectableLexicalKey, boolean>>
) {

    let lemmaStart = tokenizeToRichText(startWord)[0];
    if (typeof lemmaStart === 'object') lemmaStart = lemmaStart.l;

    let lemmaTarget = tokenizeToRichText(targetWord)[0];
    if (typeof lemmaTarget === 'object') lemmaTarget = lemmaTarget.l;

    if (!lemmaStart || !lemmaTarget) {
        throw new Error('Could not extract lemma from start or target word');
    } else if (lemmaStart === lemmaTarget) {
        throw new Error('Start and target words cannot be the same');
    }

    // const existsStart = DICTIONARY_DB.db.query.dictionary.findFirst({
    //     where: {
    //         word: lemmaStart
    //     },
    //     columns: {
    //         id: true
    //     }
    // });
    // const existsTarget = DICTIONARY_DB.db.query.dictionary.findFirst({
    //     where: {
    //         word: lemmaTarget
    //     },
    //     columns: {
    //         id: true
    //     }
    // });

    const [startEntries, targetEntries] = await Promise.all([
        getEntriesForGame(lexicalFields, lemmaStart),
        getEntriesForGame(lexicalFields, lemmaTarget),
    ]);

    // thos checks should not be necessary anymore as getEntriesForGame throws an error if no entries were found
    if (!startEntries.length) {
        throw new Error(`Start word "${lemmaStart}" does not exist in the dictionary`);
    }

    if (!targetEntries.length) {
        throw new Error(`Target word "${lemmaTarget}" does not exist in the dictionary`);
    }

    const [game] = await db
        .insert(gameTable)
        .values({
            startWord: lemmaStart,
            targetWord: lemmaTarget,
            mode,
            ...lexicalFields,
        })
        .returning();

    console.debug(
        'Created game with start word:',
        lemmaStart,
        'and target word:',
        lemmaTarget,
        'for player ID:',
        playerID,
        'with lexical fields:',
        lexicalFields
    );

    await joinGame(playerID, game, true);

    return game;
}

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

export async function getEntriesForGame(game: Partial<Pick<Game, SelectableLexicalKey>>, word: string) {
    // works as if field is not on game its -> undefined -> false, which is the default value in the table anyways
    const senseLexicalFields = SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS.filter((field) => game[field]);
    const extraEntryFields = SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS.filter((field) => game[field]);
    const sharedLexicalFields = SELECTABLE_SHARED_LEXICAL_KEYS.filter((field) => game[field]);

    return getDictionaryEntries(word, sharedLexicalFields, senseLexicalFields, extraEntryFields);
}

export async function addRaceStep(
    game: Game,
    playerId: string,
    token: RichToken,
    side: 'start' | 'target' = 'start'
) {
    // this also validates that the token is in the  and otherwise throws an error
    const entries = await getEntriesForGame(game, token.l);

    const newStep: RaceStep = {
        word: token.l,
        timestamp: Date.now(),
    };

    let updatedLink;

    if (side === 'start') {
        [updatedLink] = await db
            .update(gamePlayerLink)
            .set({
                startLinks: sql`${gamePlayerLink.startLinks} || ${JSON.stringify([newStep])}::jsonb`,
            })
            .where(and(eq(gamePlayerLink.gameId, game.id), eq(gamePlayerLink.playerId, playerId)))
            .returning();
    } else {
        [updatedLink] = await db
            .update(gamePlayerLink)
            .set({
                targetLinks: sql`${gamePlayerLink.targetLinks} || ${JSON.stringify([newStep])}::jsonb`,
            })
            .where(and(eq(gamePlayerLink.gameId, game.id), eq(gamePlayerLink.playerId, playerId)))
            .returning();
    }

    return { entries, newStep, found: updatedLink.found };
}
