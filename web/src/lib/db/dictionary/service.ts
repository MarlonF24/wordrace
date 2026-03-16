import { db } from "./db";
import { tokenize, type Token } from "@/lib/lemmatisation";

interface sense {
    id: string;
    senseid: string[];
    glosses: string[];
    links: [string, string][];
}


export async function getDictionaryEntries(word: string) {
    const entries = await db.query.dictionary.findMany({
        columns: {
            pos: true,
            senses: true,
        },
        where: {
            word: word,
        }
    })

    const parsedEntries = entries.map(entry => {
        if (!entry.senses || !entry.pos) {
            throw new Error("Invalid definition data: missing senses or pos: " + JSON.stringify(entry));
        } 
        const parsedSenses = JSON.parse(entry.senses) as sense[];
        return {
            pos: entry.pos,
            senses: parsedSenses,
        }
    })

    return parsedEntries;
}

export async function getSenses(word: string) {
    const entries = await getDictionaryEntries(word);

    const senses =  entries.map(entry => {
        return {pos: entry.pos, senses: processSenses(entry.senses.map(s => s.glosses))};
    });

    return senses;
}

export interface GlossNode {
    text: string;
    tokens: Token[];
    children: GlossNode[];
}

export function processSenses(senses: string[][]): GlossNode[] {
    /* Senses are in the following format, where each inner array represents a path of segments in the gloss tree,
    this function processes that into a tree structure for easier rendering. For example, the following glosses:

    glosses: [
      [ "A common, firm, round fruit produced by a tree of the genus Malus.",
        "The fruit of the tree Malus domestica, chiefly with a green, red, or yellow skin, cultivated in temperate climates for cidermaking, cooking, and eating."
      ], [ "A common, firm, round fruit produced by a tree of the genus Malus.",
        "Often with a qualifying word: any fruit or vegetable, or any other thing (such as a cone or gall) produced by a plant, especially if from a tree and similar to the fruit of Malus domestica (noun, sense 1.1)."
      ], [ "A common, firm, round fruit produced by a tree of the genus Malus.",
        "Something which resembles the fruit of Malus domestica (noun, sense 1.1) in shape (such as a ball, breast, or globe) or colour."
      ]

    Would be processed into the following tree structure:
    
    [
        {   
            text: "A common, firm, round fruit produced by a tree of the genus Malus.",
            children: [
                {
                    text: "The fruit of the tree Malus domestica, chiefly with a green, red, or yellow skin, cultivated in temperate climates for cidermaking, cooking, and eating.",
                    children: []
                },
                {
                    text: "Often with a qualifying word: any fruit or vegetable, or any other thing (such as a cone or gall) produced by a plant, especially if from a tree and similar to the fruit of Malus domestica (noun, sense 1.1).",
                    children: []
                },
                {
                    text: "Something which resembles the fruit of Malus domestica (noun, sense 1.1) in shape (such as a ball, breast, or globe) or colour.",
                    children: []
                }
            ]
        }
    ]   
    */
    const root: GlossNode[] = [];

    for (const glossPath of senses) {
        let currentLevel = root;
        
        for (const segment of glossPath) {
            // Check if this segment already exists at the current level
            let node = currentLevel.find(n => n.text === segment);
            
            if (!node) {
                node = { 
                    text: segment, 
                    tokens: tokenize(segment),
                    children: [] 
                };
                currentLevel.push(node);
            }
            
            currentLevel = node.children;
        }
    }

    return root;
}

// const test = await getSenses("apple");

// console.log(await getSenses("apple"));



