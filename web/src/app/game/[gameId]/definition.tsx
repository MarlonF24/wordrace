"use client";

import { useActionState, useEffect, startTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { getGlossesAction } from "@/lib/db/dictionary/actions";

interface Gloss {
    pos: string;
    glosses: string[][];
}

export function DefinitionDisplay(
  { word, addLinkToHistory }: { word: string, addLinkToHistory: (newLink: string) => void }
) {
    const [glosses, dispatch, isPending] = useActionState<Gloss[], string>(
        async (_, wordToFetch) => {
            return await getGlossesAction(wordToFetch);
        },
        []
    );

    useEffect(() => {
        startTransition(() => {
            dispatch(word);
        });
    }, [word, dispatch]);

    const isLoading = isPending || glosses === null;

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
        <CardContent className="flex-1 overflow-y-auto space-y-6 pt-6">
          {isLoading ? (
             <div className="flex items-center justify-center p-8">
                <span className="text-muted-foreground animate-pulse">Loading definition...</span>
             </div>
          ) : (
             glosses?.map((def, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-bold uppercase border-2 shadow-[2px_2px_0px_0px_var(--shadow-color)] px-2 py-0.5 bg-secondary text-secondary-foreground">
                  {def.pos}
                </Badge>
              </div>
              <ul className="list-disc pl-5 space-y-2 marker:text-muted-foreground">
                {def.glosses.flat?.().map((gloss, j) => (
                  <li key={j} className="text-lg leading-relaxed">
                    {gloss}
                  </li>
                ))}
              </ul>
            </div>
          )))}
          {!isLoading && glosses?.length === 0 && (
             <div className="flex items-center justify-center p-8">
                <span className="text-muted-foreground">No definition found.</span>
             </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}