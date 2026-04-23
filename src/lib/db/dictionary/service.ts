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
} from "./types";

import { processRawEntry } from "./seed";



type FixedEntryKey = Exclude<EntryKey, SelectableLexicalKey>;

// as only the entry keys are available at runtime, we split it up to be able to filter  
export async function getDictionaryEntries<
    SH extends SelectableSharedLexicalKey, 
    E extends SelectableExclusiveEntryLexicalKey, 
    S extends SelectableExclusiveSenseLexicalKey
>(
    word: string,
    sharedLexicalFields: SH[] = [],
    exclusiveSenseLexicalFields: S[] = [],
    exclusiveEntryLexicalFields: E[] = [],

): Promise<Entry[]> {

    const selectedEntryLexicalFields = [...sharedLexicalFields, ...exclusiveEntryLexicalFields]

    const fixedColumns: Record<FixedEntryKey, true> = {
        word: true,
        pos: true,
        senses: true,
    }

    const entrygameColumns = Object.fromEntries(selectedEntryLexicalFields.map(f => [f, true])) as Record<EntryKey, true>;

    const queryWord = word.toLowerCase();

    const entries = await db.query.dictionary.findMany({
        columns: {
            ...fixedColumns,
            ...entrygameColumns,
        },
        where: {
            word: queryWord,
        }
    });

    
    const selectedSenseLexicalFields = [...exclusiveSenseLexicalFields, ...sharedLexicalFields];
    
    let noSenseLexicalFieldsFound = true;

    const processedEntries = entries.map(entry => {
        const { senses, ...rest } = entry;
        
        // remove falsy values (e.g. null, "" or []
        const falsyCleanedRest = Object.fromEntries(Object.entries(rest).filter(([, value]) => !isFalsy(value))) as Pick<typeof rest, Exclude<FixedEntryKey, "senses"> | Extract<SH | E, EntryKey>>; 
        
        const { rootNodes, foundSenseLexicalFields } = processGlossNodes(senses, new Set(selectedSenseLexicalFields));
        
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
        throw new Error(`Word "${queryWord}" does not exist in the dictionary or none of the requested lexical fields (${[...selectedEntryLexicalFields, ...exclusiveSenseLexicalFields].join(", ")}) were found on the entries or their senses`);
    }
    

    return processedEntries;
}



function processGlossNodes<S extends SelectableSenseLexicalKey>(rootNodes: GlossNode[], senseLexicalFields: Set<S>): { rootNodes: GlossNode[], foundSenseLexicalFields: Set<S> } {
    // cleans glossnodes from unselected lexical fields
        
    const nodesToProcess = [...rootNodes];
    const foundSenseLexicalFields = new Set<S>();

    // DFS
    while (nodesToProcess.length > 0) {
        const node = nodesToProcess.pop()!; // pops last element -> DFS
        const cleanedLexicalFields = {} as Partial<GlossNode["lexicalFields"]>; 

        for (const lexicalKey of Object.keys(node.lexicalFields) as S[]) {
            if (senseLexicalFields.has(lexicalKey)) {
                cleanedLexicalFields[lexicalKey] = node.lexicalFields[lexicalKey];
                foundSenseLexicalFields.add(lexicalKey);
            }
        }

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


