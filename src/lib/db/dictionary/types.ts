import { type WiktionaryPosTag } from '@/lib/part-of-speech';

export interface Linkage {
    word: string; // may also be multiple words but called "word"
}

export const LINKAGE_TYPES = [
    'synonyms',
    'antonyms',
    'hypernyms',
    'hyponyms',
    'holonyms',
    'meronyms',

    'derived',
    'related',
    'coordinate_terms',
] as const;

export type LinkageType = (typeof LINKAGE_TYPES)[number];

// lexical fields that exist both at entry and sense level
type RawSharedLexicalFields = Record<LinkageType, Linkage[]> & {};
export type RawSharedLexicalKey = keyof RawSharedLexicalFields;

//----------------------------------------
interface Example {
    text: string;
    ref: string;
    type: string;
}

// lexical fields that only exist at sense level
type RawExclusiveSenseLexicalFields = {
    glosses: string[];
    examples: Example[];
    links: [string, string][];
};
export type RawExclusiveSenseLexicalKey = keyof RawExclusiveSenseLexicalFields;

// all lexical fields on a sense
export type RawSenseLexicalFields = RawExclusiveSenseLexicalFields & RawSharedLexicalFields;
export type SenseLexicalKey = keyof RawSenseLexicalFields;

// Sense = default fields + exclusive sense lexical fields + shared lexical fields
export type RawSense = {
    id: string;
    senseid: string[];
} & Partial<RawSenseLexicalFields>;

type RawSenseKey = keyof RawSense;

// ----------------------------------------
export interface Category {
    kind: string;
    name: string;
}

export type Topic = {
    name: string;
};

// lexical fields that only exist at entry level
export type RawExclusiveEntryLexicalFields = {
    categories: Category[];
    topics: Topic[];
    etymology_text: string;
};
export type RawExclusiveEntryLexicalKey = keyof RawExclusiveEntryLexicalFields;

export type RawEntry = {
    word: string;
    pos: string;
    senses: RawSense[];
} & Partial<RawExclusiveEntryLexicalFields> &
    Partial<RawSharedLexicalFields>;

type RawEntryKey = keyof RawEntry;

export type RawLexicalFields = RawExclusiveEntryLexicalFields & RawExclusiveSenseLexicalFields & RawSharedLexicalFields;

// ----------------------------
// ----------------------------

export const SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS = [
    'glosses',
    'examples',
] as const satisfies ReadonlyArray<RawExclusiveSenseLexicalKey>;

export const SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS_SET: ReadonlySet<SelectableExclusiveSenseLexicalKey> = new Set(
    SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS
);

export const SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS = [
    'categories',
    // "topics"
] as const satisfies ReadonlyArray<RawExclusiveEntryLexicalKey>;

export const SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS_SET: ReadonlySet<SelectableExclusiveEntryLexicalKey> = new Set(
    SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS
);

export const SELECTABLE_SHARED_LEXICAL_KEYS = [
    'antonyms',
    'synonyms',
    'hypernyms',
    'hyponyms',
    'holonyms',
    'meronyms',
    'derived',
    'related',
    'coordinate_terms',
] as const satisfies ReadonlyArray<RawSharedLexicalKey>;

export const SELECTABLE_SHARED_LEXICAL_KEYS_SET: ReadonlySet<SelectableSharedLexicalKey> = new Set(
    SELECTABLE_SHARED_LEXICAL_KEYS
);

export type SelectableExclusiveSenseLexicalKey = (typeof SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS)[number];
export type SelectableExclusiveEntryLexicalKey = (typeof SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS)[number];
export type SelectableSharedLexicalKey = (typeof SELECTABLE_SHARED_LEXICAL_KEYS)[number];

export const SELECTABLE_SENSE_LEXICAL_KEYS = [
    ...SELECTABLE_SHARED_LEXICAL_KEYS,
    ...SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS,
] as const;
export type SelectableSenseLexicalKey = (typeof SELECTABLE_SENSE_LEXICAL_KEYS)[number];

export const SELECTABLE_ENTRY_LEXICAL_KEYS = [
    ...SELECTABLE_SHARED_LEXICAL_KEYS,
    ...SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS,
] as const;
export type SelectableEntryLexicalKey = (typeof SELECTABLE_ENTRY_LEXICAL_KEYS)[number];

export const SELECTABLE_ENTRY_LEXICAL_KEYS_SET: ReadonlySet<SelectableEntryLexicalKey> = new Set(SELECTABLE_ENTRY_LEXICAL_KEYS);

export const SELECTABLE_LEXICAL_KEYS = [
    ...SELECTABLE_SHARED_LEXICAL_KEYS,
    ...SELECTABLE_EXCLUSIVE_SENSE_LEXICAL_KEYS,
    ...SELECTABLE_EXCLUSIVE_ENTRY_LEXICAL_KEYS,
] as const;
export type SelectableLexicalKey = (typeof SELECTABLE_LEXICAL_KEYS)[number];

export type RichToken = {
    l: string; // lemma
    p: WiktionaryPosTag; // Wiktionary-style part of speech
    w: string; // original word
};

// RichText is an array of RichTokens (clickable) and strings (non-clickable/punctuation/spaces).
export type RichText = (RichToken | string)[];

export type Flatten<T> = T extends (infer U)[] ? NonNullable<U> : NonNullable<T>;

type RawSelectableLexicalFields = Pick<RawLexicalFields, SelectableLexicalKey>;

// flattened version of each selecatble lexical field value
type FlatSelectableLexicalFields = {
    [K in keyof RawSelectableLexicalFields]: Flatten<RawSelectableLexicalFields[K]>;
};
export type FlatObjectSelectableLexicalKey = {
    [K in SelectableLexicalKey]: FlatSelectableLexicalFields[K] extends object ? K : never;
}[SelectableLexicalKey];

// all lexical keys that map to an object or object[]
export type FlatObjectSelectableLexicalFields = Pick<FlatSelectableLexicalFields, FlatObjectSelectableLexicalKey>;

type KeysOfValue<T, V> = {
    [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

// which fields to print out of the
export const OBJECT_FIELDS_TO_PRINT: {
    [K in keyof FlatObjectSelectableLexicalFields]: readonly KeysOfValue<
        FlatObjectSelectableLexicalFields[K],
        string
    >[];
} = {
    antonyms: ['word'],
    synonyms: ['word'],
    hypernyms: ['word'],
    hyponyms: ['word'],
    holonyms: ['word'],
    meronyms: ['word'],
    derived: ['word'],
    related: ['word'],
    examples: ['text'],
    categories: ['name'],
    coordinate_terms: ['word'],
} as const;

type WithRichText<T> = T extends string
    ? RichText
    : T extends string[]
      ? RichText[]
      : T extends object
        ? { [K in keyof T]: WithRichText<T[K]> }
        : never;

export type ProcessedFlatObjectlexicalField<K extends FlatObjectSelectableLexicalKey> = {
    [P in (typeof OBJECT_FIELDS_TO_PRINT)[K][number]]: RichText;
};

export type ProcessedlexicalField<K extends SelectableLexicalKey> = K extends FlatObjectSelectableLexicalKey // if linking to object or object[]
    ? RawLexicalFields[K] extends unknown[] // if linking to object[]
        ? ProcessedFlatObjectlexicalField<K>[]
        : ProcessedFlatObjectlexicalField<K>
    : K extends 'glosses'
      ? RichText // glosses are an exception where after processing the last element of the string[] becomes a RichText
      : WithRichText<RawLexicalFields[K]>;

export type SelectableSenseLexicalFields = {
    [K in SelectableSenseLexicalKey]: ProcessedlexicalField<K>;
};

export type GlossNode = {
    children: GlossNode[];
    lexicalFields: Partial<SelectableSenseLexicalFields>;
};

export type EntryLexicalFields = {
    [K in SelectableEntryLexicalKey]: ProcessedlexicalField<K>;
};

export type LexicalEntry = {
    pos: string;
    senses: GlossNode[];
} & Partial<EntryLexicalFields>;

export type WordRecord = {
    word: string;
    lexicalEntries: LexicalEntry[];
};

export type SelectableLexicalFields = Pick<EntryLexicalFields, SelectableEntryLexicalKey> &
    Pick<SelectableSenseLexicalFields, SelectableExclusiveSenseLexicalKey>;

export type EntryKey = keyof WordRecord;
