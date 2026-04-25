import { db } from "./db";

import { isFalsy } from "@/lib/utils";
import { 
    type SelectableExclusiveEntryLexicalKey, 
    type SelectableExclusiveSenseLexicalKey, 
    type SelectableSharedLexicalKey, 
    type Entry,
    type EntryKey,
    type GlossNode,
    SelectableLexicalKey,
    SelectableSenseLexicalKey,
    SelectableEntryLexicalKey,
} from "./types";

import { processRawEntry } from "./seed";



type FixedEntryKey = Exclude<EntryKey, SelectableLexicalKey>;

type Typ<T extends string> = {
    [K in T]?: true;
};

// as only the entry keys are available at runtime, we split it up to be able to filter  
export async function getDictionaryEntries(
    word: string,
    sharedLexicalFields: Typ<SelectableSharedLexicalKey> = {},
    exclusiveSenseLexicalFields: Typ<SelectableExclusiveSenseLexicalKey> = {},
    exclusiveEntryLexicalFields: Typ<SelectableExclusiveEntryLexicalKey> = {},
): Promise<Entry[]> {


    const fixedColumns: Record<FixedEntryKey, true> = {
        word: true,
        pos: true,
        senses: true,
    }


    const queryWord = word.toLowerCase(); // dictionary fully lowercased



    const entries = await db.query.dictionary.findMany({
        columns: {
            ...fixedColumns,
            ...sharedLexicalFields,
            ...exclusiveEntryLexicalFields,
        },
        where: {
            word: queryWord,
        }
    });

    const selectedSenseLexicalFields = { ...sharedLexicalFields, ...exclusiveSenseLexicalFields }
    
    let noSenseLexicalFieldsFound = true;

    const processedEntries = entries.map(entry => {
        const { senses, ...rest } = entry;
        
        // remove falsy values (e.g. null, "" or []
        const falsyCleanedRest = Object.fromEntries(Object.entries(rest).filter(([, value]) => !isFalsy(value))) as Pick<typeof rest, Exclude<FixedEntryKey, "senses"> | Extract<SelectableEntryLexicalKey, keyof typeof rest>>; 
        
        const { rootNodes, foundSenseLexicalFields } = processGlossNodes(senses, selectedSenseLexicalFields);
        
        noSenseLexicalFieldsFound = noSenseLexicalFieldsFound && foundSenseLexicalFields.size === 0;

        return {
            senses: rootNodes,
            ...falsyCleanedRest
        };
    });

    // we filter here cause ijts falsy cleaned
    const noEntryLexicalFieldsFound = processedEntries.every(entry => Object.entries(entry).length <= Object.keys(fixedColumns).length);

    // whether theres actually stuff to display (will always throw if entries === [])
    if (noEntryLexicalFieldsFound && noSenseLexicalFieldsFound) {
        throw new Error(`Word "${queryWord}" does not exist in the dictionary or none of the requested lexical fields (${[...Object.keys(sharedLexicalFields), ...Object.keys(exclusiveSenseLexicalFields)].join(", ")}) were found on the entries or their senses`);
    }
    

    return processedEntries;
}



function processGlossNodes(rootNodes: GlossNode[], senseLexicalFields: Typ<SelectableSenseLexicalKey>): { rootNodes: GlossNode[], foundSenseLexicalFields: Set<SelectableSenseLexicalKey> } {
    // cleans glossnodes from unselected lexical fields
        
    const nodesToProcess = [...rootNodes];
    const foundSenseLexicalFields = new Set<SelectableSenseLexicalKey>();

    // DFS
    while (nodesToProcess.length > 0) {
        const node = nodesToProcess.pop()!; // pops last element -> DFS
   
        const cleanedLexicalFields = Object.fromEntries(
            Object.entries(node.lexicalFields).filter(([key]) => {

                const found = senseLexicalFields[key as SelectableSenseLexicalKey];
                if (found) foundSenseLexicalFields.add(key as SelectableSenseLexicalKey);
                return found;
            })
        );

        node.lexicalFields = cleanedLexicalFields;

        nodesToProcess.push(...node.children);
    }

    return { rootNodes, foundSenseLexicalFields };
}


// const rawEntrySample = (await db.query.dictionaryRaw.findFirst({
//     where: {
//         id: 1354
//     }
// }))!;

// processRawEntry(rawEntrySample.raw_data)

// const entries = await getDictionaryEntries("cpu", [], ["glosses"], []);

// // entries[0].senses[0].
// // entries[0].senses[0].examples;
// console.log(entries);


