import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

import { type RichText } from './db/dictionary';


const nlp = winkNLP(model);
const { its } = nlp;




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
            });
        }
    };

    return result;
}



// tokenize("The quick, brown fox jumps over the lazy dog.")