
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import HeroSection from "./hero-sections-01";
import StartGameForm from "./start-game-form";

export default function WelcomePage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex flex-col lg:flex-row items-center justify-center gap-12 lg:gap-24 max-w-6xl w-full">
        <HeroSection />
        <Card id="start-race" className="w-full max-w-md scroll-mt-24 shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Start a Race</CardTitle>
          <CardDescription className="text-center">
            Enter a start word and a target word to begin the race.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StartGameForm />
        </CardContent>
      </Card>
      </div>
    </main>
  );
}