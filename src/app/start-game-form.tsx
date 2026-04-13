"use client";

import { useActionState, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { startGameAction } from "./start-game-action";
import { GAME_MODES, type GameMode } from "@/lib/db/data/schema";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

import { type SelectableExtraKey } from "@/lib/db/data/schema";



// TODO: make better descriptions 
export const EXTRA_KEYS: Record<SelectableExtraKey, { label: string; desc: string }> = {
    antonyms: { label: "Antonyms", desc: "Words with opposite meanings" },
    synonyms: { label: "Synonyms", desc: "Words with similar meanings" },
    hypernyms: { label: "Hypernyms", desc: "Words with more general meanings" },
    hyponyms: { label: "Hyponyms", desc: "Words with more specific meanings" },
    holonyms: { label: "Holonyms", desc: "Words that denote a whole whose part is the base word" },
    meronyms: { label: "Meronyms", desc: "Words that denote a part of the base word" },
    derived: { label: "Derived Forms", desc: "Words that are derived from the base word" },
    related: { label: "Related Words", desc: "Words that are etymologically related to the base word" },
    categories: { label: "Include Categories", desc: "Categories or domains the word belongs to" },
    topics: { label: "Include Topics", desc: "Topics associated with the word" },
    examples: { label: "Include Examples", desc: "Example sentences using the word" },
};



export default function StartGameForm() {
  

  const [state, formAction, isPending] = useActionState(
    (prevState: unknown, formData: FormData) => {
      const startWord = formData.get("startWord")!.toString();
      const targetWord = formData.get("targetWord")!.toString();


      const mode = (formData.get("mode")?.toString() as GameMode) || "normal";
      
      const extraFields = formData.getAll("extraFields") as (keyof typeof EXTRA_KEYS)[];
      console.debug("Selected extra fields:", extraFields);
      
      
      return startGameAction({ startWord, targetWord, mode, ...Object.fromEntries(extraFields.map((key) => [key, true])) });
    
    }, null 
  ); 
  
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.error) {
      setError(state.error);
    }
  }, [state?.error]);


  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);

  const extraKeyArray = Object.entries(EXTRA_KEYS);
  
  return ( 
        <form className="flex flex-col gap-6" action={formAction} onChange={() => { setError(null);}}>
            {error && (
              <span className="bg-destructive/15 text-destructive text-sm font-medium p-2 rounded-lg border border-destructive/20">
                {error}
              </span>
            )}
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
                  <div key={mode} className="relative flex items-center space-x-2 border-2 rounded-lg p-3 flex-1 has-data-[state=checked]:border-primary transition-colors hover:bg-muted/30">
                    <RadioGroupItem value={mode} id={`mode-${mode}`} />
                    <Label htmlFor={`mode-${mode}`} className="absolute inset-0 cursor-pointer" />
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`mode-${mode}`} className="font-bold uppercase tracking-tight cursor-pointer">{label}</Label>
                      <span className="text-xs text-muted-foreground">{description}</span>
                    </div>
                  </div>
                ))}
              </RadioGroup>
              
              {/* Hidden inputes  */}
              {selectedModifiers.map((id) => (
                <input key={id} type="hidden" name="extraFields" value={id} />
              ))}

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="secondary" className="w-full justify-between" type="button">
                    Modifiers & Extra Options
                  </Button>
                </PopoverTrigger>

                <PopoverContent className="w-[--radix-popover-trigger-width] p-4" align="start" >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {extraKeyArray.map(([field, { label, desc }]) => (
                      <label
                        key={field}
                        htmlFor={field}
                        className="flex flex-row items-start space-x-3 cursor-pointer hover:bg-muted/50 p-2 -m-2 rounded-lg transition-colors"
                      >
                        <Checkbox
                          id={field}
                          className="mt-1"
                          checked={selectedModifiers.includes(field)}
                          onCheckedChange={(checked) => {
                            setSelectedModifiers((prev) =>
                              checked
                                ? [...prev, field]
                                : prev.filter((id) => id !== field)
                            );
                          }}
                        />
                        <div className="space-y-1 leading-none">
                          <span className="font-semibold text-sm">
                            {label}
                          </span>
                          <p className="text-xs text-muted-foreground max-w-[160px]">{desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <Button onClick={() => {
                    if (selectedModifiers.length != extraKeyArray.length) {
                      setSelectedModifiers(Object.keys(EXTRA_KEYS))}
                    else { setSelectedModifiers([])}}
                    }>

                    Select All</Button>
                </PopoverContent>
              </Popover>
            </div>

            <Button type="submit" className="w-full mt-2 h-10 text-base font-bold border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all" size="lg" disabled={isPending}>
              Start Game {isPending && <span className="ml-2 animate-pulse">...</span>}
            </Button>
          </form>
    )
}