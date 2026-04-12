"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { type InferSelectModel } from "drizzle-orm";
import { type gameTable } from "@/lib/db/data/schema";


export function FoundPopup({ game, gamePlayerLink }: { game: InferSelectModel<typeof gameTable>; gamePlayerLink: { durationMs: number; linkCount: number } }) {

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
                    <Button onClick={() => redirect("/")}>Play Again</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}