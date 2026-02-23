import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

const nlp = winkNLP(model);
const { its } = nlp;

export function getLemmaInContext(sentence: string, targetWordIdx: number) {
    const doc = nlp.readDoc(sentence);
    const tokens = doc.tokens();

    if (targetWordIdx < 0 || targetWordIdx >= tokens.length()) throw new RangeError("targetWordIdx is out of bounds");
    const targetToken = tokens.itemAt(targetWordIdx);
  return {
    word: targetToken.out(its.value),
    // @ts-expect-error some weird issue where .lemma is has the wrong type, but it works at runtime
    lemma: targetToken.out(its.lemma),
    pos: targetToken.out(its.pos), 
  };
}
