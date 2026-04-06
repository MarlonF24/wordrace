"use client";

import { cn } from "@/lib/utils";
import { useClickContext } from "./clickContext";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

import { FIELDS_TO_PRINT, 
    type SelectableEntriesReturn, 
    type SelectableSenseExtraKey 
} from "@/lib/db/data/schema";

import { type GlossNode } from "@/lib/db/dictionary";

import { ExtraFieldBadge } from "./extraFieldDisplay";
import { PosBadge } from "./posBadge";

export function SensesDisplay({
    entries,
}: {
    entries: SelectableEntriesReturn;
}) {
    if (!entries || entries.length === 0) {
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
            <div className="space-y-8 pb-20">
                {entries.map((entry, i) => (
                    <div key={i} className="flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <PosBadge pos={entry.pos} />
                        </div>
                        <ul className="space-y-4">
                            {entry.senses.map((node, j) => (
                                <RenderGlossNode
                                    key={j}
                                    node={node}
                                    index={j}
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

export function RenderTextWithButtons({
    tokens,
    fullText,
    onWordClick,
}: {
    tokens: GlossNode<SelectableSenseExtraKey>['tokens'],
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
    depth = 0
}: {
    node: GlossNode<SelectableSenseExtraKey>,
    index: number,
    depth?: number
}) {
    const { onWordClick } = useClickContext();
    const isTopLevel = depth === 0;
    
    // Determine marker based on depth
    let marker = "";
    if (depth === 0) marker = `${index + 1}.`;
    else if (depth === 1) marker = `${String.fromCharCode(97 + (index % 26))}.`;
    else marker = "•";

    const extraFieldsEntries = Object.entries(node.extraFields).filter(([, v]) => v && (!Array.isArray(v) || v.length > 0));
    const extraFieldsPresent = extraFieldsEntries.length > 0;

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
            
            {extraFieldsPresent && (
                <div className={cn("mt-2", isTopLevel ? "ml-8" : "ml-6")}>
                    <Collapsible className="group/collapsible bg-muted/20 border-border/50 rounded-md border w-fit data-[state=open]:w-full transition-all duration-300">
                        <CollapsibleTrigger className="flex w-full items-center justify-between p-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors group">
                            <span>Extra Fields</span>
                            <ChevronDown className="h-4 w-4 ml-2 group-data-[state=open]:rotate-180 transition-transform" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="p-3 space-y-3 border-t border-border/50 text-sm">
                            {extraFieldsEntries.map(([key, val]) => {
                                const fieldKey = key as SelectableSenseExtraKey;
                                const printKeys = FIELDS_TO_PRINT[fieldKey] || [];
                                
                                const items = Array.isArray(val) ? val : [val];
                                
                                return (
                                    <div key={key} className="space-y-1">
                                        <div className="text-xs font-bold text-muted-foreground uppercase">{key}:</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {items.map((item: unknown, itemIdx: number) => {
                                                const isObj = typeof item === 'object' && item !== null;
                                                const displayText = printKeys.length > 0 && isObj
                                                    ? (printKeys as string[]).map(k => String((item as Record<string, unknown>)[k] ?? "")).filter(Boolean).join(" ")
                                                    : (isObj ? JSON.stringify(item) : String(item));

                                
                                                return (
                                                    <ExtraFieldBadge 
                                                        key={itemIdx}
                                                        displayText={displayText}
                                                        onClick={() => onWordClick(displayText, 0)}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </CollapsibleContent>
                    </Collapsible>
                </div>
            )}

            {node.children && node.children.length > 0 && (
                <ul className={cn(
                    "space-y-2 mt-2",
                    isTopLevel ? "pl-10" : "pl-6"
                )}>
                    {node.children.map((child, idx) => (
                        <RenderGlossNode
                            key={idx}
                            node={child}
                            index={idx}
                            depth={depth + 1}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

