import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function HeroSection() {
  return (
    <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
  
      <h1 className="font-heading my-4 text-4xl text-balance md:text-5xl lg:leading-14">
        Race from Word to Word
      </h1>
      <p className="text-muted-foreground mb-8 text-balance lg:text-lg max-w-125">
        Challenge yourself to navigate from a starting word to a target word using the words in Wiktionary definitions. How fast can you make the connection?
      </p>
      <div className="flex justify-center gap-2">
        <Button asChild>
          <Link href="#start-race">Start a Race</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/leaderboard">View Leaderboard</Link>
        </Button>
      </div>
    </div>
  );
}
