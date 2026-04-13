import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

const nlp = winkNLP(model);
const { its } = nlp;

export type Token = {
    value: string;
    precedingSpaces: string;
    isPunctuation: boolean;
    wordIdx?: number;
    index: number;
}

export function tokenize(text: string): Token[] {
    const doc = nlp.readDoc(text);
    const tokens = doc.tokens();
    let wordIdxCounter = 0;
    const result: Token[] = [];

    tokens.each((t, i) => {
        const isPunct = t.out(its.pos) === 'PUNCT';
        result.push({
            value: t.out(its.value),
            precedingSpaces: t.out(its.precedingSpaces),
            isPunctuation: isPunct,
            wordIdx: isPunct ? undefined : wordIdxCounter++,
            index: i
        });
    });

    return result;
}

export function getLemmaInContext(sentence: string, targetTokenIdx: number) {
    const doc = nlp.readDoc(sentence);
    const tokens = doc.tokens();

    if (targetTokenIdx < 0 || targetTokenIdx >= tokens.length()) {
        throw new RangeError(`targetTokenIdx ${targetTokenIdx} is out of bounds (length: ${tokens.length()})`);
    }
    
    const targetToken = tokens.itemAt(targetTokenIdx);
    
  return {
    word: targetToken.out(its.value),
    // @ts-expect-error some weird issue where .lemma is has the wrong type, but it works at runtime
    lemma: targetToken.out(its.lemma),
    pos: targetToken.out(its.pos), 
  };
}
