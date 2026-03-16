import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SensesDisplay } from "./senses";
import { type getSenses } from "@/lib/db/dictionary/service";

export function DefinitionDisplay(
  { word, senses, onWordClick}: { 
    word: string, 
    senses: Awaited<ReturnType<typeof getSenses>>,
    onWordClick: (sentence: string, wordIdx: number) => Promise<void>
  }
) {

  return (
    <main className="h-full w-full flex flex-col items-center justify-start py-4 px-4 md:p-4 gap-4 md:gap-6 overflow-hidden relative">
      <div className="flex-none flex flex-col items-center gap-1 md:gap-2 text-center mt-1">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Current Definition</h2>
        <h1 className="text-2xl md:text-3xl lg:text-5xl font-black tracking-tighter text-foreground uppercase truncate max-w-[90vw] px-4" title={word}>{word}</h1>
      </div>

      <Card className="flex-1 min-h-0 w-full max-w-4xl border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] bg-card flex flex-col mx-auto rounded-xl">
        <CardHeader className="flex-none border-b-2 border-border py-3 md:py-4">
          <CardTitle className="text-lg md:text-xl font-bold uppercase tracking-tight text-center md:text-left">Definitions</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-thin">
            <SensesDisplay senses={senses} onWordClick={onWordClick}/>
        </CardContent>
      </Card>
    </main>
  );
}