"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";


export default function StartGameForm() {
    return ( 
        <form className="flex flex-col gap-4" >
            <div className="flex flex-col gap-2">
              <label htmlFor="start-word" className="text-sm font-medium leading-none">
                Start Word
              </label>
              <Input id="start-word" name="startWord" placeholder="e.g. apple" required />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="target-word" className="text-sm font-medium leading-none">
                Target Word
              </label>
              <Input id="target-word" name="targetWord" placeholder="e.g. banana" required />
            </div>

            <Button type="submit" className="w-full mt-4">
              Start Game
            </Button>
          </form>
    )
}