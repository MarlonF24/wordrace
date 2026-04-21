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
                v: token.out(its.value),
                // @ts-expect-error: wink-nlp messed up typing again
                l: token.out(its.lemma),
            });
        }
    };

    return result;
}

// const res = tokenizeToRichText("Numerous experimental tests and other observations have been offered in favor of animal mind reading, and although many scientists are skeptical, others assert that humans are not the only species capable of representing what others do and don’t perceive and know.")

// console.log(res);
// export function tokenize(text: string): Token[] {
//     const doc = nlp.readDoc(text);
//     const tokens = doc.tokens();
//     let wordIdxCounter = 0;
//     const result: Token[] = [];

//     tokens.each((t, i) => {
//         const isPunct = t.out(its.pos) === 'PUNCT';
//         result.push({
//             value: t.out(its.value),
//             precedingSpaces: t.out(its.precedingSpaces),
//             isPunctuation: isPunct,
//             wordIdx: isPunct ? undefined : wordIdxCounter++,
//             index: i
//         });
//     });

//     return result;
// }

// export function getLemmaInContext(sentence: string, targetTokenIdx: number) {
//     const doc = nlp.readDoc(sentence);
//     const tokens = doc.tokens();

//     if (targetTokenIdx < 0 || targetTokenIdx >= tokens.length()) {
//         throw new RangeError(`targetTokenIdx ${targetTokenIdx} is out of bounds (length: ${tokens.length()})`);
//     }
    
//     const targetToken = tokens.itemAt(targetTokenIdx);
    
//   return {
//     word: targetToken.out(its.value),
//     // @ts-expect-error some weird issue where .lemma has the wrong type, but it works at runtime
//     lemma: targetToken.out(its.lemma),
//     pos: targetToken.out(its.pos), 
//   };
// }


// tokenize("The quick, brown fox jumps over the lazy dog.")