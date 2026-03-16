"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { startGameFormAction } from "./start-game-action";
import { GAME_MODES } from "@/lib/db/data/schema";


export default function StartGameForm() {
  
  const [_, formAction, isPending] = useActionState((prevState: unknown, formData: FormData) => startGameFormAction(formData), null); 
  
  return ( 
        <form className="flex flex-col gap-6" action={formAction}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="start-word" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Start Word
              </label>
              <Input id="start-word" name="startWord" placeholder="e.g. apple" required className="h-10 text-base border-2" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="target-word" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Target Word
              </label>
              <Input id="target-word" name="targetWord" placeholder="e.g. banana" required className="h-10 text-base border-2" />
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Game Mode</span>
              <RadioGroup defaultValue="normal" name="mode" className="flex gap-4">
                {Object.entries(GAME_MODES).map(([mode, { label, description }]) => (
                  <div key={mode} className="relative flex items-center space-x-2 border-2 rounded-lg p-3 flex-1 has-[[data-state=checked]]:bg-muted/50 has-[[data-state=checked]]:border-primary transition-colors hover:bg-muted/30">
                    <RadioGroupItem value={mode} id={`mode-${mode}`} />
                    <Label htmlFor={`mode-${mode}`} className="absolute inset-0 cursor-pointer" />
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`mode-${mode}`} className="font-bold uppercase tracking-tight cursor-pointer">{label}</Label>
                      <span className="text-xs text-muted-foreground">{description}</span>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <Button type="submit" className="w-full mt-2 h-10 text-base font-bold border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all" size="lg" disabled={isPending}>
              Start Game {isPending && <span className="ml-2 animate-pulse">...</span>}
            </Button>
          </form>
    )
}