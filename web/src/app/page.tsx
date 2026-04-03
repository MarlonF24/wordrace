
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import StartGameForm from "./start-game-form";

export default function WelcomePage() {
  return (
    <main className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="grid lg:grid-cols-[1fr_360px] gap-14 w-full max-w-5xl items-center">

        <div className="flex flex-col gap-6 text-center lg:text-left">

          <h1 className="text-5xl md:text-6xl lg:text-7xl font-black tracking-tighter leading-[0.95] text-foreground">
            Race from<br />
            <span className="text-primary">word</span>
            <span className="text-muted-foreground font-light"> to </span>
            <span className="text-primary">word</span>
          </h1>

          <p className="text-base md:text-lg text-muted-foreground max-w-sm mx-auto lg:mx-0 leading-relaxed">
            Connect any two words by navigating through their Wiktionary definitions. Fewest steps wins.
          </p>

          <div className="flex flex-wrap justify-center lg:justify-start gap-3 pt-2">
            <Button
              asChild
              size="lg"
              className="font-(family-name:--font-space-grotesk) font-bold tracking-wide px-8 h-11 border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all"
            >
              <Link href="#start-race">Start Racing</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="font-(family-name:--font-space-grotesk) font-bold tracking-wide px-8 h-11 border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all"
            >
              {/* <Link href="/leaderboard">Leaderboard</Link> */}
            </Button>
          </div>
        </div>

        <Card
          id="start-race"
          className="justify-self-center w-[360px] border-2 shadow-[6px_6px_0px_0px_var(--shadow-color)] bg-card"
        >
          <CardHeader className="pb-4 border-b-2 border-border">
            <CardTitle className="text-xl font-black uppercase tracking-tight">New Game</CardTitle>
            <CardDescription className="text-sm">Pick a start word and a target word</CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <StartGameForm />
          </CardContent>
        </Card>

      </div>
    </main>
  );
}
