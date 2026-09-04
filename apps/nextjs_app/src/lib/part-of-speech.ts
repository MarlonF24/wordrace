export const WIKTIONARY_POS_TAGS = [
    "phrase",
    "adv_phrase",
    "suffix",
    "infix",
    "prep",
    "adv",
    "article",
    "prep_phrase",
    "contraction",
    "intj",
    "name",
    "pron",
    "postp",
    "adj",
    "circumfix",
    "num",
    "verb",
    "proverb",
    "conj",
    "affix",
    "noun",
    "punct",
    "symbol",
    "prefix",
    "character",
    "particle",
    "det",
    "interfix"
] as const;



export type WiktionaryPosTag = (typeof WIKTIONARY_POS_TAGS)[number];

export const WIKTIONARY_POS_TAGS_SET: ReadonlySet<string> = new Set(WIKTIONARY_POS_TAGS);


/* (https://winkjs.org/wink-nlp/part-of-speech.html)

Part-of-Speech reference
winkNLP follows the Universal POS tags, a summary of which is given in the table below. The POS tags of a token can be accessed via the out( its.pos ) method.

Some POS tags are language and context dependent. For example, gerunds may be tagged as either VERB or NOUN. Look at the POS tag of the word “singing” in these two example sentences:

“I love singing/VERB.”
“Singing/NOUN is my hobby.”
POS tag	Description	Example
ADJ	Adjective: Red, unique, rare, huge, happy	That building is huge/ADJ!
ADP	Adposition: There are prepositions and postpositions lik in, of, to etc.	The dog jumped over/ADP the wall.
ADV	Adverb: Very, happyli, briefly, soon	The roads are very/ADV steep.
AUX	Auxiliary: Do, did, is, am, are, should, must, will	I must/AUX get some sleep.
CCONJ	Coordinating conjuction: And, or, but	I like tea and/CCONJ coffee.
DET	Determiner: Words like an article, possessive, demonstrative, or quantifier. For example, my, that, few, etc.	This/DET laptop is mine.
INTJ	Interjection: Alas, oh, wow	Wow/INTJ, what a beautiful day!
NOUN	Noun: Man, dog, table, chair	The woman/NOUN in the picture/NOUN is my mother/NOUN.
NUM	Numeral: A word or number like one, five, 3.14, 100, etc.	All visitors must pay $20/NUM.
PART	Particle: 's, not, n't	I am not/PART feeling well.
PRON	Pronoun: You, I he, she, myself, what, who, something, nobody, mine	I/PRON like coffee. What/PRON about you/PRON?
PROPN	Proper noun: Words that refer to a specific person, place or thing like John Smith, London, UN, etc.	Mary/PROPN lives in Chicago/PROPN.
PUNCT	Punctuation marks: like ‘Period: .’, ‘Comma: ,’, ‘Parentheses: ()’	Hello,/PUNCT world!/PUNCT
SCONJ	Subordinating conjuction: That, if, while	Since/SCONJ he lost his money he couldn't go on the camping trip.
SYM	Symbol: Currency symbols($), Mathematical operators(+,=), emojis and emoticons( :), 😝), etc.	Hello :)/SYM
VERB	Verb: Run, sing, develop	I run/VERB 3 miles every morning.
X	Other: Words that cannot be assigned any POS tag	He is my मित्र/X
SPACE	Space: New line (\n), tab (\t), return (\r) or any combination of these characters is tagged as SPACE. This tag is not based on Universal POS tags.	Hello     /SPACE world!
*/

export const WINK_POS_TAGS = [
    "ADJ",
    "ADP",
    "ADV",
    "AUX",
    "CCONJ",
    "DET",
    "INTJ",
    "NOUN",
    "NUM",
    "PART",
    "PRON",
    "PROPN",
    "PUNCT",
    "SCONJ",
    "SYM",
    "VERB",
    "X",
    "SPACE"
] as const;

export type WinkPosTag = (typeof WINK_POS_TAGS)[number];

export const WINK_POS_TAGS_SET: ReadonlySet<string> = new Set(WINK_POS_TAGS);

/**
 * Return whether a runtime string is a Wink NLP part-of-speech tag.
 *
 * This check keeps tokenizer output and persisted game data inside the
 * vocabulary shared by the web game and ML search API.
 */
export function isWinkPosTag(value: string): value is WinkPosTag {
    return WINK_POS_TAGS_SET.has(value);
}
