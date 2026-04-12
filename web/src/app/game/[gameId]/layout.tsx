
import { GameProvider } from "@/components/context/gameId";
import { ErrorProvider } from "@/components/context/error";
import { DATA_DB } from "@/lib/db";


export default async function Layout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ gameId: string }>
}) {
    const { gameId } = await params;

    const game = await DATA_DB.db.query.gameTable.findFirst({
        where: { id: gameId }
    });

    if (!game) {
        throw new Error("Game not found");
    }

    return (
        <GameProvider value={game}>
            <ErrorProvider>
                {children}
            </ErrorProvider>
        </GameProvider>
    )
}
