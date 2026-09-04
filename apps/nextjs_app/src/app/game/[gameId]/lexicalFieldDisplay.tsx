import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { 
    type SelectableEntryLexicalKey, 
    OBJECT_FIELDS_TO_PRINT, 
    type WordRecord,
    type RichText
} from "@/lib/db/dictionary/types";

import { PosBadge } from "./posBadge";
import { RichTextRenderer } from "./rich-text-renderer";


export function LexicalFieldBadge({ 
    tokens, 
    side,
    className 
}: { 
    tokens: RichText; 
    side: "start" | "target";
    className?: string;
}) {
    
    return (
        <Badge 
            variant="secondary" 
            className={cn(
                "text-base font-semibold py-1.5 px-3 border-2 border-border bg-primary text-secondary-foreground transition-all shadow-sm flex flex-wrap gap-x-0 h-auto whitespace-normal max-w-full rounded-none",
                className
            )}
        >
            <RichTextRenderer tokens={tokens} side={side} />
        </Badge>
    );
}

export function LexicalFieldDisplay({ 
    lexicalKey, 
    record,
    side
}: { 
    lexicalKey: SelectableEntryLexicalKey; 
    record: WordRecord; 
    side: "start" | "target";
}) {
    

    const printKeys = (OBJECT_FIELDS_TO_PRINT)[lexicalKey] || [];
    
    return (
        <div className="flex flex-col space-y-8">
            {record.lexicalEntries.map((entry, entryIdx) => {
                const val = entry[lexicalKey];
                if (!val) return null;

                const items = Array.isArray(val) ? val : [val];
                
                return (
                    <div key={entryIdx} className="flex flex-col gap-3">
                        <div className="flex items-center">
                            <PosBadge pos={entry.pos} />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {items.map((item, idx) => {
                                return (printKeys as (keyof typeof item)[]).map((pk) => (
                                    <LexicalFieldBadge 
                                        key={`${idx}-${pk}`}
                                        tokens={item[pk]}
                                        side={side}
                                    />
                                ));
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
