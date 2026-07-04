'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { startGameAction } from './start-game-action';
import { GAME_MODES, type GameMode } from '@/lib/db/data/schema';
import { DATA_DB } from '@/lib/db';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

import {
    SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS_SET,
    SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS,
    SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS_SET,
    SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS,
    SELECTABLE_SHARED_LEXICAL_KEYS_SET,
    SELECTABLE_SHARED_LEXICAL_KEYS,
    type SelectableExclusiveEntryLexicalKey,
    type SelectableExclusiveSenseLexicalKey,
    type SelectableSharedLexicalKey,
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

const ALWAYS_SELECTED_LEXICAL_FIELDS: Set<SelectableLexicalKey> = new Set(); // "are not shown as options, always selected"
const DEFAULT_SELECTED_LEXICAL_FIELDS: Set<SelectableLexicalKey> = new Set(["glosses"])
const INITIAL_SELECTED_LEXICAL_FIELDS: Set<SelectableLexicalKey> = ALWAYS_SELECTED_LEXICAL_FIELDS.union(DEFAULT_SELECTED_LEXICAL_FIELDS)

/**
 * Render the game creation form and submit its selected options to the server action.
 *
 * The form keeps lexical-field UI state client-side, serializes selected fields
 * into hidden inputs, and receives validation errors from `startGameAction`.
 */
export default function StartGameForm() {
    const [selectedExclusiveEntryLexicalKeys, setSelectedExclusiveEntryLexicalKeys] = useState<
        SelectableExclusiveEntryLexicalKey[]
    >([...SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS_SET.intersection(INITIAL_SELECTED_LEXICAL_FIELDS)]);

    const [selectedExclusiveSenseLexicalKeys, setSelectedExclusiveSenseLexicalKeys] = useState<
        SelectableExclusiveSenseLexicalKey[]
    >([...SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS_SET.intersection(INITIAL_SELECTED_LEXICAL_FIELDS)]);

    const [selectedSharedLexicalKeys, setSelectedSharedLexicalKeys] = useState<SelectableSharedLexicalKey[]>([
        ...SELECTABLE_SHARED_LEXICAL_KEYS_SET.intersection(INITIAL_SELECTED_LEXICAL_FIELDS),
    ]);

    const [lemmatise, setLemmatise] = useState(true);

    const LEXICAL_SECTIONS = {
        shared: {
            keys: SELECTABLE_SHARED_LEXICAL_KEYS,
            state: selectedSharedLexicalKeys,
            setter: setSelectedSharedLexicalKeys,
            name: 'sharedLexicalFields',
        },
        exclusiveSense: {
            keys: SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS,
            state: selectedExclusiveSenseLexicalKeys,
            setter: setSelectedExclusiveSenseLexicalKeys,
            name: 'exclusiveSenseLexicalFields',
        },
        exclusiveEntry: {
            keys: SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS,
            state: selectedExclusiveEntryLexicalKeys,
            setter: setSelectedExclusiveEntryLexicalKeys,
            name: 'exclusiveEntryLexicalFields',
        },
    } as const;

    function toggleLexicalField<T extends SelectableLexicalKey>(
        setter: React.Dispatch<React.SetStateAction<T[]>>,
        field: T,
        checked: boolean
    ) {
        setter((prev) => (checked ? [...prev, field] : prev.filter((id) => id !== field)));
    }

    function setAllLexicalFields<T extends SelectableLexicalKey>(
        setter: React.Dispatch<React.SetStateAction<T[]>>,
        keys: readonly T[],
        all: boolean
    ) {
        if (all) {
            setter([...keys]);
        } else {
            setter([...new Set(keys).intersection(ALWAYS_SELECTED_LEXICAL_FIELDS)] as T[]);
        }
    }

    const [error, setError] = useState<string | null>(null);

    const [, formAction, isPending] = useActionState(async (_prevState: unknown, formData: FormData) => {
        const startWord = formData.get('startWord')!.toString();
        const targetWord = formData.get('targetWord')!.toString();

        const mode = formData.get('mode')?.toString() as GameMode;
        const lemmatise = formData.get('lemmatise') === 'true';

        const exclusiveEntryLexicalFields = Object.fromEntries(
            formData.getAll(LEXICAL_SECTIONS.exclusiveEntry.name).map((k) => [k, true])
        );

        const exclusiveSenseLexicalFields = Object.fromEntries(
            formData.getAll(LEXICAL_SECTIONS.exclusiveSense.name).map((k) => [k, true])
        );

        const sharedLexicalFields = Object.fromEntries(
            formData.getAll(LEXICAL_SECTIONS.shared.name).map((k) => [k, true])
        );

        console.debug('Assembled lexical fields:', {
            exclusiveEntryLexicalFields,
            exclusiveSenseLexicalFields,
            sharedLexicalFields,
        });

        const gameData: DATA_DB.GameInsert = {
            startWord,
            targetWord,
            mode,
            lemmatise,
            exclusiveEntryLexicalFields,
            exclusiveSenseLexicalFields,
            sharedLexicalFields,
        };

        const result = await startGameAction(gameData);
        if (result?.error) {
            setError(result.error);
        }
        return result;
    }, null);

    const lexicalFieldsControl = (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {Object.entries(LEXICAL_SECTIONS).map(([key, section]) => {
                const { keys, state, setter } = section;
                return (keys as readonly SelectableLexicalKey[]).map((field) => {
                    if (ALWAYS_SELECTED_LEXICAL_FIELDS.has(field)) return null;
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
                                checked={(state as readonly string[]).includes(field)}
                                onCheckedChange={(checked) => {
                                    if (key === 'shared') {
                                        toggleLexicalField(
                                            setter as React.Dispatch<
                                                React.SetStateAction<SelectableSharedLexicalKey[]>
                                            >,
                                            field as SelectableSharedLexicalKey,
                                            !!checked
                                        );
                                    } else if (key === 'exclusiveSense') {
                                        toggleLexicalField(
                                            setter as React.Dispatch<
                                                React.SetStateAction<SelectableExclusiveSenseLexicalKey[]>
                                            >,
                                            field as SelectableExclusiveSenseLexicalKey,
                                            !!checked
                                        );
                                    } else if (key === 'exclusiveEntry') {
                                        toggleLexicalField(
                                            setter as React.Dispatch<
                                                React.SetStateAction<SelectableExclusiveEntryLexicalKey[]>
                                            >,
                                            field as SelectableExclusiveEntryLexicalKey,
                                            !!checked
                                        );
                                    }
                                }}
                            />
                            <div className="space-y-1 leading-none">
                                <span className="font-semibold text-sm">{label}</span>
                                <p className="text-xs text-muted-foreground max-w-[160px]">{desc}</p>
                            </div>
                        </label>
                    );
                });
            })}
        </div>
    );

    const selectAllButton = (
        <Button
            type="button"
            size="sm"
            className="self-start text-xs text-muted-foreground"
            onClick={() => {
                const allKeys = Object.keys(LEXICAL_KEY_DISPLAYS) as SelectableLexicalKey[];
                const currentTotal = Object.values(LEXICAL_SECTIONS).reduce((acc, { state }) => acc + state.length, 0);

                const selectAll = currentTotal < allKeys.length;

                Object.entries(LEXICAL_SECTIONS).forEach(([key, section]) => {
                    if (key === 'shared') {
                        setAllLexicalFields(
                            section.setter as React.Dispatch<React.SetStateAction<SelectableSharedLexicalKey[]>>,
                            section.keys as readonly SelectableSharedLexicalKey[],
                            selectAll
                        );
                    } else if (key === 'exclusiveSense') {
                        setAllLexicalFields(
                            section.setter as React.Dispatch<
                                React.SetStateAction<SelectableExclusiveSenseLexicalKey[]>
                            >,
                            section.keys as readonly SelectableExclusiveSenseLexicalKey[],
                            selectAll
                        );
                    } else if (key === 'exclusiveEntry') {
                        setAllLexicalFields(
                            section.setter as React.Dispatch<
                                React.SetStateAction<SelectableExclusiveEntryLexicalKey[]>
                            >,
                            section.keys as readonly SelectableExclusiveEntryLexicalKey[],
                            selectAll
                        );
                    }
                });
            }}
        >
            {Object.values(LEXICAL_SECTIONS).reduce((acc, { state }) => acc + state.length, 0) ===
            Object.keys(LEXICAL_KEY_DISPLAYS).length
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

                {/* Hidden inputs  */}
                {selectedExclusiveEntryLexicalKeys.map((id) => {
                    return <input key={id} type="hidden" name="exclusiveEntryLexicalFields" value={id} />;
                })}
                {selectedExclusiveSenseLexicalKeys.map((id) => {
                    return <input key={id} type="hidden" name="exclusiveSenseLexicalFields" value={id} />;
                })}
                {selectedSharedLexicalKeys.map((id) => {
                    return <input key={id} type="hidden" name="sharedLexicalFields" value={id} />;
                })}
                <input type="hidden" name="lemmatise" value={String(lemmatise)} />

                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="secondary" className="w-full justify-between" type="button">
                            Modifiers & Extra Options
                        </Button>
                    </PopoverTrigger>

                    <PopoverContent className="w-[min(72rem,calc(100vw-2rem))] p-4 flex flex-col gap-4" align="start">
                        <div className="flex flex-col gap-3 pb-2 border-b">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                General Options
                            </span>
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
                                    <p className="text-xs text-muted-foreground max-w-[200px]">
                                        Clicking a word matches its base dictionary form (e.g. &quot;running&quot;
                                        matches &quot;run&quot;).
                                    </p>
                                </div>
                            </label>
                        </div>

                        <div className="flex flex-col gap-3">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Extra Lexical Fields
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
