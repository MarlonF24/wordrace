import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { type RaceStep } from "@/lib/db/data"
import { cn } from "@/lib/utils"

function formattedTimeTaken(current: RaceStep, previous: RaceStep) {
    const start = new Date(previous.timestamp)
    const end = new Date(current.timestamp)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return "-"
    }

    const diffMs = end.getTime() - start.getTime()
    const diffSeconds = Math.floor(diffMs / 1000)
    
    if (diffSeconds < 60) {
        return `${diffSeconds}s`
    }

    const minutes = Math.floor(diffSeconds / 60)
    const seconds = diffSeconds % 60
    return `${minutes}m ${seconds}s`
}

export function History({ currentLinks }: { currentLinks: RaceStep[] }) {

    if (!currentLinks) return null

    return (
        <Card className="h-full min-w-80 w-80 border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] bg-card flex flex-col overflow-hidden rounded-[0]">
            <CardHeader className="flex-none border-b-2 border-border pb-4 bg-muted/20 px-6 py-4">
                <CardTitle className="text-xl font-bold uppercase tracking-tight">History ({currentLinks.length})</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
                <div className="flex flex-col w-full">
                    {currentLinks.map((step, index) => {
                        const isStart = index === 0
                        const timeTaken = !isStart
                            ? formattedTimeTaken(step, currentLinks[index - 1])
                            : "Start"

                        return (
                            <div
                                key={index}
                                className={cn(
                                    "px-6 py-3 border-b border-border last:border-0 hover:bg-muted/50 transition-colors flex justify-between items-center group/item",
                                    isStart && "bg-muted/30"
                                )}
                            >
                                <span className="font-bold text-lg uppercase truncate max-w-[140px]" title={step.word}>
                                    {step.word}
                                </span>
                                <span className="text-xs font-mono font-bold text-muted-foreground bg-secondary px-2 py-1 rounded border border-border shadow-[1px_1px_0px_0px_var(--shadow-color)] group-hover/item:bg-background transition-colors">
                                    {timeTaken}
                                </span>
                            </div>
                        )
                    })}
                </div>
            </CardContent>
        </Card>
    )
}