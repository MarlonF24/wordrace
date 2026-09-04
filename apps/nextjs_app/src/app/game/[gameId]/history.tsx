import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { type RaceStep } from "@/lib/db/data"
import { cn } from "@/lib/utils"

function formattedTimeTaken(current: RaceStep, previous: RaceStep) {
    const diffMs = current.timestamp - previous.timestamp
    const diffSeconds = Math.floor(diffMs / 1000)
    
    if (diffSeconds < 60) {
        const tenths = Math.floor((diffMs % 1000) / 100)
        return `${diffSeconds}.${tenths}s`
    }

    const minutes = Math.floor(diffSeconds / 60)
    const seconds = diffSeconds % 60
    return `${minutes}m ${seconds}s`
}

export function History({ currentLinks, className }: { currentLinks: RaceStep[], className?: string }) {
    if (!currentLinks) return null

    return (
        <Card className={cn("h-full w-full border-r-2 bg-card flex flex-col overflow-hidden rounded-none border-l-0 border-y-0", className)}>
            <CardHeader className="flex-none border-b-2 border-border p-3 md:p-4">
                <CardTitle className="text-sm md:text-xl font-bold uppercase tracking-tight px-0 md:px-2 truncate">
                    History <span className="text-muted-foreground ml-1">({currentLinks.length})</span>
                </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0 flex flex-col-reverse justify-end scrollbar-thin">
                {currentLinks.map((step, index) => {
                    const isStart = index === 0
                    
                    const previousStep = currentLinks[index - 1]
                    
                    const timeTaken = previousStep
                        ? formattedTimeTaken(step, previousStep)
                        : "Start"

                    return (
                        <div
                            key={step.timestamp.toString() + index}
                            className={cn(
                                "px-3 py-2 md:px-6 md:py-3 border-b border-border flex justify-between items-center gap-2 shrink-0 group hover:bg-muted/50 transition-colors",
                                isStart && "bg-muted/30"
                            )}
                        >
                            <span className="font-bold text-sm md:text-lg uppercase truncate flex-1 min-w-0" title={step.word}>
                                {step.word}
                            </span>
                            <span className="text-[10px] md:text-xs font-mono font-bold text-muted-foreground bg-secondary px-1.5 py-0.5 rounded border border-border opacity-60 group-hover:opacity-100 transition-opacity">
                                {timeTaken}
                            </span>
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    )
}