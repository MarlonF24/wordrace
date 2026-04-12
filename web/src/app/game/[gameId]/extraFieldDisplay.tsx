import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { 
    type SelectableEntryExtraKey, 
    FIELDS_TO_PRINT, 
    type SelectableEntriesReturn 
} from "@/lib/db/data/schema";

import { WordButton } from "./word-button";
import { PosBadge } from "./posBadge";

export function ExtraFieldBadge({ 
    displayText, 
    side,
    className 
}: { 
    displayText: string; 
    side: "start" | "target";
    className?: string;
}) {
    const tokens = displayText.split(/(\s+)/);

    return (
        <Badge 
            variant="secondary" 
            className={cn(
                "text-base font-semibold py-1.5 px-3 border-2 border-border bg-primary text-secondary-foreground transition-all shadow-sm flex flex-wrap gap-x-0 h-auto whitespace-normal max-w-full rounded-none",
                className
            )}
        >
            {tokens.map((token, idx) => {
                const isSpace = /^\s+$/.test(token);
                if (isSpace) return <span key={idx} className="whitespace-pre">{token}</span>;
                
                const tokenIndex = tokens.slice(0, idx).filter(t => !/^\s+$/.test(t)).length;

                return (
                    <WordButton
                        key={idx}
                        fullText={displayText}
                        tokenIndex={tokenIndex}
                        side={side}
                    >
                        {token}
                    </WordButton>
                );
            })}
        </Badge>
    );
}

export function ExtraFieldDisplay({ 
    extraKey, 
    entries,
    side
}: { 
    extraKey: SelectableEntryExtraKey; 
    entries: SelectableEntriesReturn; 
    side: "start" | "target";
}) {
    const printKeys = FIELDS_TO_PRINT[extraKey];
    
    return (
        <div className="flex flex-col space-y-8">
            {entries.map((entry, entryIdx) => {
                const val = (entry as Record<string, unknown>)[extraKey];
                if (!val) return null;

                const items = Array.isArray(val) ? val : [val];
                
                return (
                    <div key={entryIdx} className="flex flex-col gap-3">
                        <div className="flex items-center">
                            <PosBadge pos={entry.pos} />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {items.map((item, idx) => {
                                const isObj = typeof item === 'object' && item !== null;
                                
                                const displayText = printKeys.length > 0 && isObj
                                    ? (printKeys as string[]).map(k => String((item as Record<string, unknown>)[k] ?? "")).filter(Boolean).join(" ")
                                    : (isObj ? JSON.stringify(item) : String(item));

                                return (
                                    <ExtraFieldBadge 
                                        key={idx}
                                        displayText={displayText}
                                        side={side}
                                    />
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
