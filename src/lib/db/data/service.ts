import { db } from './db';
import { playerTable, gameTable, gamePlayerLink, type RaceStep, type Game, type GameInsert } from './schema';
import { eq, and, sql } from 'drizzle-orm';
import { cache } from 'react';

import { getWordRecord, RichToken } from '../dictionary';
import { tokenizeToRichText } from '@/lib/lemmatisation';
import { isFunctionWordToken } from '@/lib/part-of-speech';

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

export async function createGame(playerID: string, gameData: GameInsert) {
    // integrity checks, some are also done by the db itself but...

    if (
        !gameData.sharedLexicalFields &&
        !gameData.exclusiveSenseLexicalFields &&
        !gameData.exclusiveEntryLexicalFields
    ) {
        throw new Error('At least one lexical field must be selected to create a game');
    }


    
    const startToken = tokenizeToRichText(gameData.startWord)[0];
    if (typeof startToken !== 'object') throw new Error('Could not tokenize start word'); // this happens if it punctuation or something that cannot be lemmatised, look into tokenizeToRichText for details

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

    if (gameData.mode == "collide") { // gameData.mode == undefined its "normal", so no need to check for that
        if (isFunctionWordToken(startToken)) throw new Error(`Start Word "${startToken.w}" is a function word which are prohibited in collide mode`);
        if (isFunctionWordToken(targetToken)) throw new Error(`Target Word "${targetToken.w}" is a function word which are prohibited in collide mode`);
    }

    const [startRecord, targetRecord] = await Promise.all([ // only for testing whether the words exist and have the at least one of the requested lexical fields, throws error otherwise
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

export async function addRaceStep(game: Game, playerId: string, word: RichToken, side: 'start' | 'target' = 'start') {
    const queryWord = game.lemmatise ? word.l : word.w;

    // this also validates that the token is in the  and otherwise throws an error
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
