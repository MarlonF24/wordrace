"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { type InferSelectModel } from "drizzle-orm";
import { type gameTable } from "@/lib/db/data/schema";
import { getGamePlayerLinkAction } from "@/lib/db/data/actions";
import { useEffect, useState } from "react";

export function FoundPopup({ playerId, game }: { game: InferSelectModel<typeof gameTable>; playerId: string }) {
    const router = useRouter();
    const [gamePlayerLink, setGamePlayerLink] = useState<{ durationMs: number; linkCount: number } | null>(null);

    useEffect(() => {
        getGamePlayerLinkAction(game.id, playerId).then((res) => {
            console.debug("Game player link:", res);
            if (!res) throw new Error("Game player link not found");
            setGamePlayerLink(res);
        });
    }, [game.id, playerId]);

    if (!gamePlayerLink) return null;
    
    const seconds = Math.floor(gamePlayerLink.durationMs / 1000);


    return (
        <Dialog open={true}>
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>Found!</DialogTitle>
                </DialogHeader>

                <div className="found-popup">
                    {game.mode === "collide" ? (
                        <p>
                            Congratulations! You found a common word from <b>{game.targetWord.toUpperCase()}</b> and <b>{game.startWord.toUpperCase()}</b> in <b>{seconds}</b> seconds using <b>{gamePlayerLink.linkCount}</b> links!
                            </p>
                    ) : (
                        <p>
                            Congratulations! You found <b>{game.targetWord.toUpperCase()}</b> from <b>{game.startWord.toUpperCase()}</b> in <b>{seconds}</b> seconds using <b>{gamePlayerLink.linkCount}</b> links!
                            </p>
                    )}
                    <Button onClick={() => router.push("/")}>Play Again</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}