import { getDictionaryEntries } from "./service";

const words = ["eaten"];

for (const word of words) {
    const glosses = await getDictionaryEntries(word);
    console.log(`Glosses for ${word}:`, glosses);
}