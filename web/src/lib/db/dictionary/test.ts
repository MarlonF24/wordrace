import { getGlosses } from "./service";

const words = ["eaten"];

for (const word of words) {
    const glosses = await getGlosses(word);
    console.log(`Glosses for ${word}:`, glosses);
}