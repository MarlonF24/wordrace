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

    // We render items in reverse order inside a flex-col-reverse container
    const reversedLinks = [...currentLinks].reverse();

    return (
        <Card className="h-full w-full md:w-80 border-2 bg-card flex flex-col overflow-hidden rounded-none">
            <CardHeader className="flex-none border-b-2 border-border p-4">
                <CardTitle className="text-xl font-bold uppercase tracking-tight px-2">History ({currentLinks.length})</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0 flex flex-col">
                {reversedLinks.map((step, index) => {
                    const isStart = index === reversedLinks.length - 1
                    
                    const previousStep = reversedLinks[index + 1]
                    
                    const timeTaken = previousStep
                        ? formattedTimeTaken(step, previousStep)
                        : "Start"

                    return (
                        <div
                            key={step.timestamp.toString() + index}
                            className={cn(
                                "px-6 py-3 border-b border-border flex justify-between items-center shrink-0",
                                isStart && "bg-muted/30"
                            )}
                        >
                            <span className="font-bold text-lg uppercase truncate max-w-[140px]" title={step.word}>
                                {step.word}
                            </span>
                            <span className="text-xs font-mono font-bold text-muted-foreground bg-secondary px-2 py-1 rounded border border-border">
                                {timeTaken}
                            </span>
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    )
}