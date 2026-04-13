
import { GameProvider } from "@/components/context/gameId";
import { ErrorProvider, PendingProvider } from "@/components/context";
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
                <PendingProvider>
                    {children}
                </PendingProvider>
            </ErrorProvider>
        </GameProvider>
    )
}
