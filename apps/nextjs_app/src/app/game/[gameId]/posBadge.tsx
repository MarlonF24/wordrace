import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PosBadge({ pos, className }: { pos: string; className?: string }) {
    return (
        <Badge
            variant="outline"
            className={cn(
                "text-xs font-bold uppercase border-2 shadow-[2px_2px_0px_0px_var(--shadow-color)] px-2 py-0.5 bg-secondary text-secondary-foreground",
                className
            )}
        >
            {pos}
        </Badge>
    );
}
