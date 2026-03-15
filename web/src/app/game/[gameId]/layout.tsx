
import { GameIdProvider } from "@/components/context/gameId";


export default async function Layout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ gameId: string }>
}) {
    const { gameId } = await params;

    return (
        <GameIdProvider value={gameId}>
            {children}
        </GameIdProvider>
    )
}
