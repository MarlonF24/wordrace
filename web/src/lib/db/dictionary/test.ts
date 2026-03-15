import { getSenses } from "./service";

const words = ["eaten"];

for (const word of words) {
    const glosses = await getSenses(word);
    console.log(`Glosses for ${word}:`, glosses);
}