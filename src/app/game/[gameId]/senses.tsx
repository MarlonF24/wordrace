import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { RichTextRenderer } from "./rich-text-renderer";

import { 
    type SelectableSenseLexicalKey,
    type Entry,
    OBJECT_FIELDS_TO_PRINT
} from "@/lib/db/dictionary/types";

import { type GlossNode, type SelectableLexicalFields } from "@/lib/db/dictionary";

import { LexicalFieldBadge } from "./lexicalFieldDisplay";
import { PosBadge } from "./posBadge";


export function SensesDisplay({
    entries,
    side
}: {
    entries: Entry[];
    side: "start" | "target";
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
                                    side={side}
                                />
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </div>
    );
}

function RenderGlossNode({
    node,
    index,
    depth = 0,
    side,
}: {
    node: GlossNode,
    index: number,
    depth?: number,
    side: "start" | "target";
}) {
    const isTopLevel = depth === 0;
    
    let marker = "";
    if (depth === 0) marker = `${index + 1}.`;
    else if (depth === 1) marker = `${String.fromCharCode(97 + (index % 26))}.`;
    else marker = "•";

    type NonGlossSelectableLexicalKey = Exclude<SelectableSenseLexicalKey, "glosses">;

    const nonGlossLexicalFieldsEntries = Object.entries(node.lexicalFields).filter(
        ([k, v]) => k !== "glosses" && v && (!Array.isArray(v) || v.length > 0)
    ) as [NonGlossSelectableLexicalKey, SelectableLexicalFields[NonGlossSelectableLexicalKey]][];
    const nonGlossLexicalFieldsPresent = nonGlossLexicalFieldsEntries.length > 0;

    return (
        <li className={cn("flex flex-col gap-1", !isTopLevel && "mt-1")}>
            <div className="flex gap-2">
                <span className={cn(
                    "shrink-0 font-bold",
                    isTopLevel ? "text-lg w-5" : "text-base w-4 text-muted-foreground"
                )}>
                    {marker}
                </span>
                { node.lexicalFields.glosses && (
                    <div className={cn("leading-relaxed whitespace-pre-wrap flex-1", isTopLevel ? "text-lg" : "text-base text-muted-foreground/90")}>
                        <RichTextRenderer
                            tokens={node.lexicalFields.glosses}
                            side={side}
                        />
                    </div>)}
            </div>
            
            {nonGlossLexicalFieldsPresent && (
                <div className={cn("mt-2", isTopLevel ? "ml-8" : "ml-6")}>
                    <Collapsible className="group/collapsible bg-muted/20 border-border/50 rounded-md border w-fit data-[state=open]:w-full transition-all duration-300">
                        <CollapsibleTrigger className="flex w-full items-center justify-between p-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors group">
                            <span>Extra Fields</span>
                            <ChevronDown className="h-4 w-4 ml-2 group-data-[state=open]:rotate-180 transition-transform" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="p-3 space-y-3 border-t border-border/50 text-sm">
                            {nonGlossLexicalFieldsEntries.map(([key, val]) => {
                                const fieldKey = key as Exclude<SelectableSenseLexicalKey, "glosses">;

                                const printKeys = (OBJECT_FIELDS_TO_PRINT)[fieldKey] || [];
                                
                                const items = Array.isArray(val) ? val : [val];
                                
                                return (
                                    <div key={key} className="space-y-1">
                                        <div className="text-xs font-bold text-muted-foreground uppercase">{key}:</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {items.map((item, itemIdx) => {
                                                // again, correlated union of types issue, would have to write generic function like "sesField" in seed.ts, but...
                                                return printKeys.map((pk) => (
                                                    <LexicalFieldBadge 
                                                        key={`${itemIdx}-${pk}`}
                                                        tokens={item[pk]}
                                                        side={side}
                                                    />
                                                ));
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
                            side={side}
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
