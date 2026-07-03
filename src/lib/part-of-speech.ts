export const WIKTIONARY_POS_TAGS = [
    "adj",
    "adv",
    "conj",
    "det",
    "intj",
    "noun",
    "num",
    "particle",
    "prep",
    "pron",
    "punct",
    "symbol",
    "verb",
    "name",
    "affix",
    "phrase",
] as const;

export type WiktionaryPosTag = (typeof WIKTIONARY_POS_TAGS)[number];

// Wink tags are converted once so stored rich-text tokens use the dictionary domain vocabulary.
export const WIKTIONARY_POS_BY_WINK_POS: Record<string, WiktionaryPosTag> = {
    ADJ: "adj",
    ADP: "prep",
    ADV: "adv",
    AUX: "verb",
    CCONJ: "conj",
    DET: "det",
    INTJ: "intj",
    NOUN: "noun",
    NUM: "num",
    PART: "particle",
    PRON: "pron",
    PROPN: "name",
    PUNCT: "punct",
    SCONJ: "conj",
    SYM: "symbol",
    VERB: "verb",
    X: "affix",
    SPACE: "phrase",
} as const;

// These POS classes are grammar glue in prose and should not create collide shortcuts.
export const FUNCTION_WORD_POS_TAGS: ReadonlySet<WiktionaryPosTag> = new Set([
    "conj",
    "det",
    "particle",
    "prep",
    "pron",
]);

// Wink maps AUX to Wiktionary-style "verb", so auxiliaries need a small lemma-level rule.
export const FUNCTION_WORD_AUXILIARY_LEMMAS: ReadonlySet<string> = new Set([
    "be",
    "can",
    "could",
    "do",
    "have",
    "may",
    "might",
    "must",
    "shall",
    "should",
    "will",
    "would",
]);

export function getWiktionaryPosTag(winkPos: string): WiktionaryPosTag {
    const wiktionaryPos = WIKTIONARY_POS_BY_WINK_POS[winkPos];
    if (!wiktionaryPos) {
        throw new Error(`Unknown wink-nlp POS tag: ${winkPos}`);
    }

    return wiktionaryPos;
}

export function isFunctionWordToken(token: { l: string; p: WiktionaryPosTag }): boolean {
    return FUNCTION_WORD_POS_TAGS.has(token.p) || FUNCTION_WORD_AUXILIARY_LEMMAS.has(token.l.toLowerCase());
}
