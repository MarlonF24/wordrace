import { Card, CardContent } from "@/components/ui/card";
import { SensesDisplay } from "./senses";
import { type SelectableEntriesReturn, FIELDS_TO_PRINT, type SelectableExtraKey, SELECTABLE_EXTRA_KEYS, type ExtraEntryValue } from "@/lib/db/data/schema";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ClickContextProvider, useClickContext } from "./clickContext";
import { useState, useTransition, useEffect } from "react";


export function EntriesDisplay(
  { word, entries, onWordClick}: { 
    word: string, 
    entries: SelectableEntriesReturn,
    onWordClick: (sentence: string, wordIdx: number) => Promise<void>
  }
) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleWordClick = (sentence: string, wordIdx: number) => {
    setError(null);
    startTransition(async () => {
      onWordClick(sentence, wordIdx).catch(e => {
        setError(e instanceof Error ? e.message : "An unexpected error occurred.");
      });
    });
  };

  const presentExtraFields = SELECTABLE_EXTRA_KEYS.filter(key => entries.some(entry => key in entry));

  return (
    <ClickContextProvider onWordClick={handleWordClick}>
      <main className="h-full w-full flex flex-col items-center justify-start py-4 px-4 md:p-4 gap-4 md:gap-6 overflow-hidden relative">
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg font-bold shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
            {error}
          </div>
        )}
        {isPending && (
          <div className="absolute top-4 right-4 z-50 animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
        )}
        <div className="flex-none flex flex-col items-center gap-1 md:gap-2 text-center mt-1">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Current Word</h2>
          <h1 className="text-2xl md:text-3xl lg:text-5xl font-black tracking-tighter text-foreground uppercase truncate max-w-[90vw] px-4" title={word}>{word}</h1>
        </div>

        <Tabs defaultValue="definitions" className="w-full max-w-4xl flex flex-col flex-1 min-h-0">
          <div className="flex justify-center mb-4 overflow-x-auto scrollbar-none">
            <TabsList className="bg-muted/50 border-2 border-border p-1 flex-nowrap w-min min-w-1/3  justify-start md:justify-center">
              {["definitions", ...presentExtraFields].map(value => (
                <TabsTrigger key={value} value={value} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-bold uppercase text-xs tracking-widest px-4 py-2 ">
                  {value}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {["definitions", ...presentExtraFields].map(value => (
            <TabsContent key={value} value={value} className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden focus-visible:outline-none focus-visible:ring-0 outline-none">
              <Card className="h-full p-2 border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] bg-card flex flex-col rounded-xl overflow-hidden">
                <CardContent className="flex-1 overflow-y-auto md:p-6 scrollbar-thin">
                  {value === "definitions" ? (
                    <SensesDisplay entries={entries} />
                  ) : (
                    <div className="space-y-6">
                      <ExtraFieldDisplay field={value as SelectableExtraKey} entries={entries} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </ClickContextProvider>
  );
}

function ExtraFieldDisplay({ field, entries }: { field: SelectableExtraKey, entries: SelectableEntriesReturn }) {
  const { onWordClick } = useClickContext();
  
  type ItemType = ExtraEntryValue<typeof field>;


  return (
    <div className="flex flex-col space-y-8">
      {entries.map((entry, entryIdx) => {
          const val = entry[field as keyof typeof entry];
          
          if (!val) return null;
          
          const items = Array.isArray(val) ? val : [val];
          
          return (
              <div key={entryIdx} className="flex flex-col gap-3">
                  <div className="flex items-center">
                    <Badge variant="outline" className="text-xs font-bold uppercase border-2 shadow-[2px_2px_0px_0px_var(--shadow-color)] px-2 py-0.5 bg-secondary text-secondary-foreground">
                        {entry.pos}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {items.map((item, idx) => {
                      const printKeys = Array.from(FIELDS_TO_PRINT[field]) as (keyof ItemType)[];
                      const isObj = typeof item === 'object' && item !== null;
                      
                      const displayText = printKeys.length > 0 && isObj
                        ? printKeys.map(k => String(item[k] ?? "")).filter(Boolean).join(" ")
                        : (isObj ? JSON.stringify(item) : String(item));

                      return (
                        <button 
                          key={idx}
                          onClick={() => onWordClick(displayText, 0)}
                          className="group focus:outline-none"
                        >
                          <Badge 
                            variant="secondary" 
                            className="text-base font-semibold py-1.5 px-3 border-2 border-border bg-muted text-foreground group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all shadow-sm"
                          >
                            {displayText}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
              </div>
          )
      })}
    </div>
  );
}
