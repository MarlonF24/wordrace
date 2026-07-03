import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

import { type RichText } from './db/dictionary';
import { getWiktionaryPosTag } from './part-of-speech';


const nlp = winkNLP(model);
const { its } = nlp;

/* (https://winkjs.org/wink-nlp/part-of-speech.html) 

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

export function tokenizeToRichText(text: string): RichText {
    const doc = nlp.readDoc(text);
    const tokens = doc.tokens();
    const result: RichText = [];

    for (let idx = 0; idx < tokens.length(); idx++) {
        const token = tokens.itemAt(idx);
        const precedingSpaces = token.out(its.precedingSpaces);
        if (precedingSpaces) {
            result.push(precedingSpaces);
        }
        
        const pos = token.out(its.pos);
        if (pos === 'PUNCT') {
            result.push(token.out(its.value));
        } else {
            result.push({
                w: token.out(its.value),
                // @ts-expect-error: wink-nlp messed up typing again
                l: token.out(its.lemma),
                p: getWiktionaryPosTag(pos),
            });
        }
    };

    return result;
}



// tokenize("The quick, brown fox jumps over the lazy dog.")
