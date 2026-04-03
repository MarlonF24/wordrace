import { db } from "./db";
import { tokenize, type Token } from "@/lib/lemmatisation";

import {
    type Sense, 
    type Entry,
    type EntryKey,
    type ExclusiveEntryExtraFieldKey, 
    type ExclusiveSenseExtraFieldKey, 
    type SharedExtraFieldKey } from "./schema";

import { isFalsy } from "@/lib/utils";
 

// selection of fields to select from exclusive sense extra fields and shared extra fields
export type QueryableExclusiveSenseExtraKey = Exclude<ExclusiveSenseExtraFieldKey, "links">;

// selection of fields to select from exclusive entry extra fields
export type QueryableExclusiveEntryExtraKey = Exclude<ExclusiveEntryExtraFieldKey, "etymology_text">;

// selection of fields to select from shared extra fields
export type QueryableSharedExtraKey = Exclude<SharedExtraFieldKey, "_">;

type QueryableSenseKey = QueryableExclusiveSenseExtraKey | QueryableSharedExtraKey;
type QueryableEntryKey = QueryableExclusiveEntryExtraKey | QueryableSharedExtraKey;

type FixedEntryKey = "word" | "pos" | "senses";

// as only the entry keys are available at runtime, we split it up to be able to filter  
export async function getDictionaryEntries<
    SH extends QueryableSharedExtraKey, 
    E extends QueryableExclusiveEntryExtraKey, 
    S extends QueryableExclusiveSenseExtraKey
>(
    word: string,
    sharedExtraFields: SH[] = [],
    exclusiveSenseExtraFields: S[] = [],
    exclusiveEntryExtraFields: E[] = [],
): 
// we put out objects that have the necessary entry fields (i.e. "word", "pos", "senses"), potentially some additional entry fields that are specified accross the exlusiveEntryFields and senseFields (which may also apply at entry level [see ./schema.ts]), and where the senses field is an array of GlossNodes that potentially include fields specified in the senseFields

Promise<Array< 
    Pick<Entry, Exclude<FixedEntryKey, "senses">> & 
    Partial<Pick<Entry, Extract<SH | S | E , EntryKey>>> & 
    { senses: GlossNode<S | SH>[] }
>> {

    const selectedEntryExtraFields = [...sharedExtraFields, ...exclusiveEntryExtraFields]

    const fixedKey: Record<FixedEntryKey, true> = {
        word: true,
        pos: true,
        senses: true,
    }

    const entries = await db.query.dictionary.findMany({
        columns: {
            ...fixedKey,
            ...Object.fromEntries(selectedEntryExtraFields.map(f => [f, true]))
        },
        where: {
            word: word,
        }
    });

    const selectedSenseExtraFields = [...exclusiveSenseExtraFields, ...sharedExtraFields] 


    const processesEntries = entries.map(entry => {
        const { senses, ...rest } = entry;

        // remove falsy values (e.g. null, "" or []; particularly [] is important as most columns return it if they don't have a value to not crash the json parsing [see ./schema.ts]) from the fields, just like they are removed in the .senses by processSenses down below. This allows to later simply print out present fields instead of having to check the values
        const falsyCleanedRest = Object.fromEntries(Object.entries(rest).filter(([_, value]) => !isFalsy(value))) as Pick<Entry, Exclude<FixedEntryKey, "senses"> | Extract<SH | S | E, EntryKey>>; 

        return {
            senses: processSenses(senses, selectedSenseExtraFields), // for the sense fields we also need to include the shared extra fields as those can also be present on the sense level [see ./schema.ts]
            ...falsyCleanedRest
        };
    });


    return processesEntries;
}


export type GlossNode<K extends QueryableSenseKey> = {
    text: string;
    tokens: Token[];
    children: GlossNode<K>[];
    extraFields: Partial<Pick<Sense, K>>;
}; // as the K fields are already partial in the Sense, Pick will also have them partial here


export function processSenses<S extends QueryableSenseKey>(senses: Sense[], fields: S[] = []): GlossNode<S>[] {
    /*
     Senses are hierarchical, with glosses potentially being subdefinitions of previous glosses. However, each gloss stores the complete information of its gloss path. We convert that into a tree, removing the redundant information by storing each shared bit on the highest possible shared parent.
    
     NOTE: the senses are ordered such that each sense is a child of the sense with one less gloss that was most recently encountered:
    
        Glosses: [A] -> root level  
        Glosses: [A, B] -> child of A  
        Glosses: [A, B, C] -> child of B  
        Glosses: [D] -> root level (new branch -> A, B and C are never encountered again)  
        Glosses: [D, E] -> child of D  

    returns an array of root level gloss nodes, each with a children property that contains its child glosses, and so on. If carrying a value, each of the specified fields will be an additional 
    */

    const rootLevel: GlossNode<S>[] = [];
    const lastEncountered: {glossNode: GlossNode<S>, sense: Sense}[] = []; // stores the last encountered gloss node for level i at [][i]

    for (const sense of senses) {
        const depth = sense.glosses.length;
        if (depth === 0) continue;

            // Ensure all parent nodes in the gloss path exist to prevent dropping orphaned segments
            for (let i = 1; i <= depth; i++) {
                const text = sense.glosses[i - 1];

                if (!lastEncountered[i] || lastEncountered[i].glossNode.text !== text) {
                    const node: GlossNode<S> = { text, tokens: tokenize(text), children: [], extraFields: {} };

                    if (i === 1) {
                        rootLevel.push(node);
                    } else {
                        lastEncountered[i - 1].glossNode.children.push(node);
                    }

                    lastEncountered[i] = { glossNode: node, sense: {} as Sense };
                    lastEncountered.length = i + 1; // Trim stale deeper branches
                }
            }

            lastEncountered[depth].sense = sense;
            const parentSense = depth > 1 ? lastEncountered[depth - 1]?.sense : undefined;
            const node = lastEncountered[depth].glossNode;

            for (const key of fields) {
                const val = sense[key];
                const parentVal = parentSense ? parentSense[key] : [];

                if (val === undefined) continue;

                if (Array.isArray(val) && Array.isArray(parentVal)) {
                    const pSet = new Set(parentVal.map(p => JSON.stringify(p)));
                    const diff = val.filter(v => !pSet.has(JSON.stringify(v)));
                    if (diff.length > 0) node.extraFields[key] = diff as Sense[S]; 
                } 
                else if (JSON.stringify(parentVal) !== JSON.stringify(val)) {
                    node.extraFields[key] = val;
                }
            }
        }

    return rootLevel;
}



// const entries = await db.query.dictionary.findMany({
//         columns: {
//             rawData: false,
//         },
//         where: {
//             word: "apple",
//         }
//     })



// const entries = await getDictionaryEntries("apple", ["antonyms", "derived"]);

// entries[0].senses[0].
// entries[0].senses[0].examples;
// console.log(entries);


