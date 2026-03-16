"use client";

import { useTransition, useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { type getSenses, type GlossNode } from "@/lib/db/dictionary/service";
import { cn } from "@/lib/utils";

export function SensesDisplay({
    senses,
    onWordClick
}: {
    senses: Awaited<ReturnType<typeof getSenses>>;
    onWordClick: (sentence: string, wordIdx: number) => Promise<void>;
}) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    // Clear error after 3 seconds
    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    const handleWordClick = useCallback((sentence: string, wordIdx: number) => {
        setError(null);
        startTransition(async () => {
            try {
                await onWordClick(sentence, wordIdx);
            } catch (e) {
                if (e instanceof Error) {
                    setError(e.message);
                } else {
                    setError("An unexpected error occurred.");
                }
            }
        });
    }, [onWordClick]);

    if (!senses || senses.length === 0) {
        return (
            <div className="flex items-center justify-center p-8 text-center min-h-[200px]">
                <span className="text-muted-foreground uppercase text-xs font-bold tracking-widest">
                    No definition found.
                </span>
            </div>
        );
    }

    return (
        <div className="relative h-full">
            {error && (
                <div className="fixed bottom-4 right-4 bg-destructive text-destructive-foreground px-4 py-2 rounded-md shadow-lg border-2 border-primary z-50 animate-in fade-in slide-in-from-bottom-2">
                    <p className="text-sm font-bold uppercase tracking-tight">{error}</p>
                </div>
            )}
            <div className={cn(
                "space-y-8 transition-all duration-300 pb-20", 
                isPending && "opacity-50 pointer-events-none grayscale-[0.5]"
            )}>
                {senses.map((entry, i) => (
                    <div key={i} className="flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <Badge
                                variant="outline"
                                className="text-xs font-bold uppercase border-2 shadow-[2px_2px_0px_0px_var(--shadow-color)] px-2 py-0.5 bg-secondary text-secondary-foreground"
                            >
                                {entry.pos}
                            </Badge>
                        </div>
                        <ul className="space-y-4">
                            {entry.senses.map((node, j) => (
                                <RenderGlossNode
                                    key={j}
                                    node={node}
                                    index={j}
                                    onWordClick={handleWordClick}
                                    depth={0}
                                />
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </div>
    );
}



function RenderTextWithButtons({
    tokens,
    fullText,
    onWordClick,
}: {
    tokens: GlossNode['tokens'],
    fullText: string,
    onWordClick: (sentence: string, wordIdx: number) => void,
}) {
    return (
        <>
            {tokens.map((token, index) => (
                <span key={index}>
                    {token.precedingSpaces}
                    {token.isPunctuation ? (
                        <span>{token.value}</span>
                    ) : (
                        <button
                            onClick={() => onWordClick(fullText, token.index)}
                            className="hover:underline hover:text-primary transition-colors cursor-pointer text-left inline-block"
                        >
                            {token.value}
                        </button>
                    )}
                </span>
            ))}
        </>
    );
}

function RenderGlossNode({
    node,
    index,
    onWordClick,
    depth = 0
}: {
    node: GlossNode,
    index: number,
    onWordClick: (sentence: string, wordIdx: number) => void,
    depth?: number
}) {
    const isTopLevel = depth === 0;
    
    // Determine marker based on depth
    let marker = "";
    if (depth === 0) marker = `${index + 1}.`;
    else if (depth === 1) marker = `${String.fromCharCode(97 + (index % 26))}.`; // a, b, c
    else marker = "•";

    return (
        <li className={cn("flex flex-col gap-1", !isTopLevel && "mt-1")}>
            <div className="flex gap-2">
                <span className={cn(
                    "shrink-0 font-bold",
                    isTopLevel ? "text-lg w-5" : "text-base w-4 text-muted-foreground"
                )}>
                    {marker}
                </span>
                <div className={cn("leading-relaxed whitespace-pre-wrap flex-1", isTopLevel ? "text-lg" : "text-base text-muted-foreground/90")}>
                    <RenderTextWithButtons
                        tokens={node.tokens}
                        fullText={node.text}
                        onWordClick={onWordClick}
                    />
                </div>
            </div>
            {node.children.length > 0 && (
                <ul className={cn(
                    "space-y-2",
                    isTopLevel ? "pl-10" : "pl-6"
                )}>
                    {node.children.map((child, idx) => (
                        <RenderGlossNode
                            key={idx}
                            node={child}
                            index={idx}
                            onWordClick={onWordClick}
                            depth={depth + 1}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}
