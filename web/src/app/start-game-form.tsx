"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startGameFormAction } from "./start-game-action";




export default function StartGameForm() {
  
  const [_, formAction, isPending] = useActionState((prevState: unknown, formData: FormData) => startGameFormAction(formData), null); 
  
  return ( 
        <form className="flex flex-col gap-4" action={formAction}>
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

            <Button type="submit" className="w-full mt-1 h-10 text-base font-bold border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all" size="lg">
              Start Game {isPending && <span>...</span>}
            </Button>
          </form>
    )
}