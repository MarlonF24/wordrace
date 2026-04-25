import { db } from './db';
import { playerTable, gameTable, gamePlayerLink, type RaceStep, type Game, GameInsert } from './schema';
import { eq, and, sql } from 'drizzle-orm';
import { cache } from 'react';


import {
    getDictionaryEntries,
    RichToken,
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


export async function createGame(
    playerID: string, 
    gameData: GameInsert
) {

    // integrity checks, some are also done by the db itself but...

    if (!gameData.sharedLexicalFields && !gameData.exclusiveSenseLexicalFields && !gameData.exclusiveEntryLexicalFields) {
        throw new Error('At least one lexical field must be selected to create a game');
    }

    let insertStart: string;
    let insertTarget: string;

    if (gameData.lemmatise) {
        const tokenizedStart = tokenizeToRichText(gameData.startWord)[0];
        if (typeof tokenizedStart !== "object") throw new Error('Could not tokenize start word'); // this happens if it punctuation or something that cannot be lemmatised, look into tokenizeToRichText for details 
        insertStart = tokenizedStart.l;

        const tokenizedTarget = tokenizeToRichText(gameData.targetWord)[0];
        if (typeof tokenizedTarget !== "object") throw new Error('Could not tokenize target word');
        insertTarget = tokenizedTarget.l;
    } else {
        insertStart = gameData.startWord;
        insertTarget = gameData.targetWord;
    } 


    if (insertStart === insertTarget) {
        throw new Error('Start and target words cannot be the same');
    }

    const [startEntries, targetEntries] = await Promise.all([
        getEntriesForGame(gameData, insertStart),
        getEntriesForGame(gameData, insertTarget),
    ]);

    // thos checks should not be necessary anymore as getEntriesForGame throws an error if no entries were found, but...
    if (!startEntries.length) {
        throw new Error(`Start word "${insertStart}" does not exist in the dictionary`);
    }

    if (!targetEntries.length) {
        throw new Error(`Target word "${insertTarget}" does not exist in the dictionary`);
    }

    const insert = gameData

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

export const getEntriesForGame = cache(async (game: Pick<GameInsert, "sharedLexicalFields" | "exclusiveSenseLexicalFields" | "exclusiveEntryLexicalFields">, word: string) => {

    return getDictionaryEntries(word, game.sharedLexicalFields, game.exclusiveSenseLexicalFields, game.exclusiveEntryLexicalFields);
});  


export async function addRaceStep(
    game: Game,
    playerId: string,
    word: RichToken,
    side: 'start' | 'target' = 'start'
) {
    const queryWord = game.lemmatise ? word.l : word.v;

    // this also validates that the token is in the  and otherwise throws an error
    const entries = await getEntriesForGame(game, queryWord);

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

    return { entries, newStep, found: updatedLink.found };
}
