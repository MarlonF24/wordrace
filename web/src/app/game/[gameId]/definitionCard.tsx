import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SensesDisplay } from "./senses";
import { type getSenses } from "@/lib/db/dictionary/service";

export function DefinitionDisplay(
  { word, sensesPromise}: { 
    word: string, 
    sensesPromise: ReturnType<typeof getSenses>,
  }
) {

  return (
    <main className="h-full w-full flex flex-col items-center justify-start p-6 gap-8 overflow-hidden relative">
      <div className="flex-none flex flex-col items-center gap-4 text-center mt-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Current Definition</h2>
        <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-foreground uppercase truncate max-w-full px-4" title={word}>{word}</h1>
      </div>

      <Card className="flex-1 min-h-0 w-full max-w-4xl border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] bg-card flex flex-col mx-auto">
        <CardHeader className="flex-none border-b-2 border-border pb-4">
          <CardTitle className="text-xl font-bold uppercase tracking-tight">Definitions</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto pt-6">
          <Suspense fallback={
            <div className="flex items-center justify-center p-8">
              <span className="text-muted-foreground animate-pulse font-bold tracking-widest uppercase text-xs">Loading definition...</span>
            </div>
          }>
            <SensesDisplay sensesPromise={sensesPromise}/>
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}