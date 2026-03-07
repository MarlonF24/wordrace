import { db } from "./db";

interface sense {
    id: string;
    senseid: string[];
    glosses: string[];
    links: [string, string][];
}


export async function getDefinitions(word: string) {
    const definitions = await db.query.dictionary.findMany({
        columns: {
            pos: true,
            senses: true,
        },
        where: {
            word: word,
        }
    })

    const parsedDefinitions = definitions.map(def => {
        if (!def.senses || !def.pos) {
            throw new Error("Invalid definition data: missing senses or pos: " + JSON.stringify(def));
        } 
        const parsedSenses = JSON.parse(def.senses) as sense[];
        return {
            pos: def.pos,
            senses: parsedSenses,
        }
    })

    return parsedDefinitions;
}

export async function getGlosses(word: string) {
    const definitions = await getDefinitions(word);

    const glosses =  definitions.map(def => {
        return {pos: def.pos, glosses: def.senses.map(sense => sense.glosses)};
    });

    return glosses;
}

// console.log(await getGlosses("apple"));


