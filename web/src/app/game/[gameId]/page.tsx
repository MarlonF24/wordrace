import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DATA_DB } from "@/lib/db";
import { getGlosses } from "@/lib/db/dictionary";


export default async function GamePage({
    params,
}: {
    params: Promise<{ gameId: string }>
}) {
    const { gameId } = await params;

    const { startWord, targetWord } = (await DATA_DB.db.query.gameTable.findFirst({
        where: {
            id: gameId,
        },
        columns: {
            startWord: true,
            targetWord: true
        }
    }))!
    
    const glosses = await getGlosses(startWord);

  return (
    <main className="h-[calc(100vh-3.5rem)] flex flex-col items-center justify-start p-6 max-w-3xl mx-auto w-full gap-8 overflow-hidden">
      <div className="flex-none flex flex-col items-center gap-4 text-center mt-8">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Current Word</h2>
        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-foreground uppercase">{startWord}</h1>
      </div>

      <Card className="flex-1 min-h-0 w-full border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] bg-card flex flex-col">
        <CardHeader className="flex-none border-b-2 border-border pb-4">
          <CardTitle className="text-xl font-bold uppercase tracking-tight">Definitions</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto space-y-6">
          {glosses.map((def, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-bold uppercase border-2 shadow-[2px_2px_0px_0px_var(--shadow-color)] px-2 py-0.5 bg-secondary text-secondary-foreground">
                  {def.pos}
                </Badge>
              </div>
              <ul className="list-disc pl-5 space-y-2 marker:text-muted-foreground">
                {def.glosses.flat().map((gloss, j) => (
                  <li key={j} className="text-lg leading-relaxed">
                    {gloss}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}