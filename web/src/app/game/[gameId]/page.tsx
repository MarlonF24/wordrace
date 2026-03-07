
import { DATA_DB } from "@/lib/db";
import { getPlayerId } from "@/lib/server/utils";
import { ClientFrame } from "./clientFrame";

export default async function GamePage({
    params,
}: {
    params: Promise<{ gameId: string }>
}) {
    const { gameId } = await params;
    const playerId = await getPlayerId();

    const game = (await DATA_DB.db.query.gameTable.findFirst({
        where: {
            id: gameId,
        }
    }))!
    
    const gamePlayerLink = (await DATA_DB.db.query.gamePlayerLink.findFirst({
        where: {
            gameId: gameId,
            playerId: playerId,
        }
    }))!

    if (gamePlayerLink.links.length == 0) {
        DATA_DB.addRaceStep(game.id, gamePlayerLink.playerId, game.startWord);
    }

    return (
        <ClientFrame game={game} gamePlayerLink={gamePlayerLink} />
    )
  
}