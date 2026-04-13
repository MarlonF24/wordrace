import { defineRelations } from "drizzle-orm";
import { gameTable, gamePlayerLink, playerTable } from "./schema";

export const relations = defineRelations(
    {playerTable, gameTable, gamePlayerLink}, 
    (r) => ({
    playerTable: {
        games: r.many.gameTable({
            from: r.playerTable.id.through(r.gamePlayerLink.playerId),
            to: r.gameTable.id.through(r.gamePlayerLink.gameId),
        }),
    },
    gameTable: {
        players: r.many.playerTable(),
    },
    gamePlayerLink: {
            game: r.one.gameTable({
                from: r.gamePlayerLink.gameId,
                to: r.gameTable.id,
            }),
            player: r.one.playerTable({
                from: r.gamePlayerLink.playerId,
                to: r.playerTable.id,
            }),
        },
}))