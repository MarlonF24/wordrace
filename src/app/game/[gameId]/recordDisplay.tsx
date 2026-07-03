import { Card, CardContent } from "@/components/ui/card";
import { SensesDisplay } from "./senses";

import { 
  type SelectableEntryLexicalKey, 
  type WordRecord,
  SELECTABLE_ENTRY_LEXICAL_KEYS, 
} from "@/lib/db/dictionary/types";


import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LexicalFieldDisplay } from "./lexicalFieldDisplay";


export function RecordDisplay(
  { word, record, side, suppressFunctionWords}: { 
    word: string, 
    record: WordRecord,
    side: "start" | "target",
    suppressFunctionWords: boolean,
  }
) {
  const presentEntryLexicalFields = SELECTABLE_ENTRY_LEXICAL_KEYS.filter(key => record.lexicalEntries.some(entry => key in entry));

  const tabs = ["definitions", ...presentEntryLexicalFields] as (SelectableEntryLexicalKey | "definitions")[];

  return (
    <main className="h-full w-full flex flex-col items-center justify-start py-4 px-4 md:p-4 gap-4 md:gap-6 overflow-hidden relative">
        <div className="flex-none flex flex-col items-center gap-1 md:gap-2 text-center mt-1">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Current Word</h2>
          <h1 className="text-2xl md:text-3xl lg:text-5xl font-black tracking-tighter text-foreground uppercase truncate max-w-[90vw] px-4" title={word}>{word}</h1>
        </div>

        <Tabs defaultValue="definitions" className="w-full max-w-4xl flex flex-col flex-1 min-h-0">
          <div className="w-full flex justify-center mb-4">
            <div className="w-full max-w-fit overflow-x-auto scrollbar-none rounded-xl border-2 border-border bg-muted/50 p-1">
              <TabsList className="bg-transparent border-none p-0 flex flex-nowrap min-w-max">
                {tabs.map(value => (
                  <TabsTrigger 
                    key={value} 
                    value={value} 
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-bold uppercase text-xs tracking-widest px-6 py-2 rounded-lg transition-all"
                  >
                    {value}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>

          {tabs.map(tab => (
            <TabsContent key={tab} value={tab} className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden focus-visible:outline-none focus-visible:ring-0 outline-none">
              <Card className="h-full p-2 border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] bg-card flex flex-col rounded-xl overflow-hidden">
                <CardContent className="flex-1 overflow-y-auto md:p-6 scrollbar-thin">
                  {tab === "definitions" ? (
                    <SensesDisplay record={record} side={side} suppressFunctionWords={suppressFunctionWords} />
                  ) : (
                    <div className="space-y-6">
                      <LexicalFieldDisplay lexicalKey={tab} record={record} side={side} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </main>
  );
}
