'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { startGameAction } from './start-game-action';
import { GAME_MODES, type GameMode } from '@/lib/game-modes';
import type { GameInsert } from '@/lib/db/data/schema';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

import {
    SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS,
    SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS,
    SELECTABLE_SHARED_LEXICAL_KEYS,
    SELECTABLE_LEXICAL_KEYS,
    type SelectableLexicalKey,
} from '@/lib/db/dictionary/types';

const LEXICAL_KEY_DISPLAYS: Record<SelectableLexicalKey, { label: string; desc: string }> = {
    glosses: { label: 'Glosses', desc: 'Include the glosses of the senses of the word' },
    antonyms: { label: 'Antonyms', desc: 'Words with opposite meanings' },
    synonyms: { label: 'Synonyms', desc: 'Words with similar meanings' },
    hypernyms: { label: 'Hypernyms', desc: 'Words with more general meanings' },
    hyponyms: { label: 'Hyponyms', desc: 'Words with more specific meanings' },
    holonyms: { label: 'Holonyms', desc: 'Words that denote a whole whose part is the base word' },
    meronyms: { label: 'Meronyms', desc: 'Words that denote a part of the base word' },
    derived: { label: 'Derived Words', desc: 'Words that are derived from the base word' },
    related: { label: 'Related Words', desc: 'Words that are etymologically related to the base word' },
    categories: { label: 'Categories', desc: 'Categories or domains the word belongs to' },
    examples: { label: 'Examples', desc: 'Example sentences using the word' },
    coordinate_terms: { label: 'Coordinate Terms', desc: 'Words that share a common hypernym with the base word' },
} as const;

const LEXICAL_SECTIONS = [
    {
        keys: SELECTABLE_SHARED_LEXICAL_KEYS,
        name: 'sharedLexicalFields',
    },
    {
        keys: SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS,
        name: 'exclusiveSenseLexicalFields',
    },
    {
        keys: SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS,
        name: 'exclusiveEntryLexicalFields',
    },
] as const satisfies readonly {
    keys: readonly SelectableLexicalKey[];
    name: string;
}[];

const INITIAL_SELECTED_LEXICAL_FIELDS: ReadonlySet<SelectableLexicalKey> = new Set([
    'glosses',
]);

/**
 * Convert one form field group to the JSON shape stored for game rules.
 */
function selectedFieldRecord<T extends SelectableLexicalKey>(
    formData: FormData,
    name: string,
    keys: readonly T[]
): Partial<Record<T, true>> {
    const submittedValues = new Set(formData.getAll(name));
    const selectedFields: Partial<Record<T, true>> = {};

    for (const key of keys) {
        if (submittedValues.has(key)) {
            selectedFields[key] = true;
        }
    }

    return selectedFields;
}

/**
 * Narrow a submitted mode to a configured game mode.
 */
function isGameMode(value: FormDataEntryValue | null): value is GameMode {
    return typeof value === 'string' && Object.hasOwn(GAME_MODES, value);
}

/**
 * Render the game creation form and submit its selected options to the server action.
 *
 * The form keeps lexical-field UI state client-side, serializes selected fields
 * into hidden inputs, and receives validation errors from `startGameAction`.
 */
export default function StartGameForm() {
    const [selectedLexicalFields, setSelectedLexicalFields] = useState<ReadonlySet<SelectableLexicalKey>>(
        () => new Set(INITIAL_SELECTED_LEXICAL_FIELDS)
    );
    const [lemmatise, setLemmatise] = useState(true);
    const [aiHintsEnabled, setAiHintsEnabled] = useState(false);

    const [error, setError] = useState<string | null>(null);

    const [, formAction, isPending] = useActionState(async (_prevState: unknown, formData: FormData) => {
        const startWord = formData.get('startWord');
        const targetWord = formData.get('targetWord');
        const mode = formData.get('mode');

        if (typeof startWord !== 'string' || typeof targetWord !== 'string' || !isGameMode(mode)) {
            const invalidFormError = 'The submitted game settings are invalid.';
            setError(invalidFormError);
            return { error: invalidFormError };
        }

        const gameData: GameInsert = {
            startWord,
            targetWord,
            mode,
            lemmatise: formData.get('lemmatise') === 'true',
            aiHintsEnabled: formData.get('aiHintsEnabled') === 'true',
            exclusiveEntryLexicalFields: selectedFieldRecord(
                formData,
                'exclusiveEntryLexicalFields',
                SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS
            ),
            exclusiveSenseLexicalFields: selectedFieldRecord(
                formData,
                'exclusiveSenseLexicalFields',
                SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS
            ),
            sharedLexicalFields: selectedFieldRecord(
                formData,
                'sharedLexicalFields',
                SELECTABLE_SHARED_LEXICAL_KEYS
            ),
        };

        const result = await startGameAction(gameData);
        if (result?.error) {
            setError(result.error);
        }
        return result;
    }, null);

    const lexicalFieldsControl = (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {LEXICAL_SECTIONS.map(({ keys }) =>
                keys.map((field) => {
                    const { label, desc } = LEXICAL_KEY_DISPLAYS[field];

                    return (
                        <label
                            key={field}
                            htmlFor={field}
                            className="flex flex-row items-start space-x-3 cursor-pointer hover:bg-muted/50 p-2 -m-2 rounded-lg transition-colors"
                        >
                            <Checkbox
                                id={field}
                                className="mt-1"
                                checked={selectedLexicalFields.has(field)}
                                onCheckedChange={(checked) => {
                                    setSelectedLexicalFields((currentFields) => {
                                        const nextFields = new Set(currentFields);
                                        if (checked) {
                                            nextFields.add(field);
                                        } else {
                                            nextFields.delete(field);
                                        }
                                        return nextFields;
                                    });
                                }}
                            />
                            <div className="space-y-1 leading-none">
                                <span className="font-semibold text-sm">{label}</span>
                                <p className="text-xs text-muted-foreground max-w-[160px]">{desc}</p>
                            </div>
                        </label>
                    );
                })
            )}
        </div>
    );

    const selectAllButton = (
        <Button
            type="button"
            size="sm"
            className="self-start text-xs text-muted-foreground"
            onClick={() => {
                const selectAll = selectedLexicalFields.size < SELECTABLE_LEXICAL_KEYS.length;
                setSelectedLexicalFields(
                    new Set<SelectableLexicalKey>(selectAll ? SELECTABLE_LEXICAL_KEYS : [])
                );
            }}
        >
            {selectedLexicalFields.size === SELECTABLE_LEXICAL_KEYS.length
                ? 'Deselect All Extra'
                : 'Select All'}
        </Button>
    );

    return (
        <form
            className="flex flex-col gap-6"
            action={formAction}
            onChange={() => {
                setError(null);
            }}
        >
            {error && (
                <span className="bg-destructive/15 text-destructive text-sm font-medium p-2 rounded-lg border border-destructive/20">
                    {error}
                </span>
            )}
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="start-word"
                    className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                    Start Word
                </label>
                <Input
                    id="start-word"
                    name="startWord"
                    placeholder="e.g. apple"
                    required
                    className="h-10 text-base border-2"
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="target-word"
                    className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                    Target Word
                </label>
                <Input
                    id="target-word"
                    name="targetWord"
                    placeholder="e.g. banana"
                    required
                    className="h-10 text-base border-2"
                />
            </div>

            <div className="flex flex-col gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Game Mode</span>
                <RadioGroup defaultValue="normal" name="mode" className="flex gap-4">
                    {Object.entries(GAME_MODES).map(([mode, { label, description }]) => (
                        <div
                            key={mode}
                            className="relative flex items-center space-x-2 border-2 rounded-lg p-3 flex-1 has-data-[state=checked]:border-primary transition-colors hover:bg-muted/30"
                        >
                            <RadioGroupItem value={mode} id={`mode-${mode}`} />
                            <Label htmlFor={`mode-${mode}`} className="absolute inset-0 cursor-pointer" />
                            <div className="flex flex-col gap-1">
                                <Label
                                    htmlFor={`mode-${mode}`}
                                    className="font-bold uppercase tracking-tight cursor-pointer"
                                >
                                    {label}
                                </Label>
                                <span className="text-xs text-muted-foreground">{description}</span>
                            </div>
                        </div>
                    ))}
                </RadioGroup>

                {/* Serialize the client-side selection into the server action's form payload. */}
                {LEXICAL_SECTIONS.flatMap(({ keys, name }) =>
                    keys
                        .filter((field) => selectedLexicalFields.has(field))
                        .map((field) => <input key={field} type="hidden" name={name} value={field} />)
                )}
                <input type="hidden" name="lemmatise" value={String(lemmatise)} />
                <input type="hidden" name="aiHintsEnabled" value={String(aiHintsEnabled)} />

                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="secondary" className="w-full justify-between" type="button">
                            Modifiers & Extra Options
                        </Button>
                    </PopoverTrigger>

                    <PopoverContent className="w-[min(72rem,calc(100vw-2rem))] p-4 flex flex-col gap-5" align="start">
                        <div className="flex flex-col gap-3 pb-2 border-b">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Rules
                            </span>
                            <div className="grid gap-3 md:grid-cols-3">
                                <label
                                    htmlFor="lemmatisation-checkbox"
                                    className="flex flex-row items-start space-x-3 cursor-pointer hover:bg-muted/50 p-2 -m-2 rounded-lg transition-colors"
                                >
                                    <Checkbox
                                        id="lemmatisation-checkbox"
                                        className="mt-1"
                                        checked={lemmatise}
                                        onCheckedChange={(checked) => setLemmatise(!!checked)}
                                    />
                                    <div className="space-y-1 leading-none">
                                        <span className="font-semibold text-sm">Lemmatisation</span>
                                        <p className="text-xs text-muted-foreground max-w-[220px]">
                                            Clicking a word matches its base dictionary form (e.g. &quot;running&quot;
                                            matches &quot;run&quot;).
                                        </p>
                                    </div>
                                </label>
                                <label
                                    htmlFor="ai-hints-checkbox"
                                    className="flex flex-row items-start space-x-3 cursor-pointer hover:bg-muted/50 p-2 -m-2 rounded-lg transition-colors"
                                >
                                    <Checkbox
                                        id="ai-hints-checkbox"
                                        className="mt-1"
                                        checked={aiHintsEnabled}
                                        onCheckedChange={(checked) => setAiHintsEnabled(!!checked)}
                                    />
                                    <div className="space-y-1 leading-none">
                                        <span className="font-semibold text-sm">AI Route Hints</span>
                                        <p className="text-xs text-muted-foreground max-w-[220px]">
                                            Ask the local ML agent for a hot/cold route estimate after each move.
                                        </p>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Lexical Fields
                            </span>
                            {lexicalFieldsControl}
                        </div>

                        {selectAllButton}
                    </PopoverContent>
                </Popover>
            </div>

            <Button
                type="submit"
                className="w-full mt-2 h-10 text-base font-bold border-2 shadow-[4px_4px_0px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all"
                size="lg"
                disabled={isPending}
            >
                Start Game {isPending && <span className="ml-2 animate-pulse">...</span>}
            </Button>
        </form>
    );
}
