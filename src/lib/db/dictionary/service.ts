import { db } from './db';

import {
    type SelectableExclusiveEntryLexicalKey,
    type SelectableExclusiveSenseLexicalKey,
    type SelectableSharedLexicalKey,
    type WordRecord,
    type GlossNode,
    type SelectableSenseLexicalKey,
    type SelectableEntryLexicalKey,
    SELECTABLE_ENTRY_LEXICAL_KEYS_SET,
} from './types';

type TrueJSON<T extends string> = {
    [K in T]?: true;
};

/**
 * Load one processed dictionary record and filter it to the lexical fields selected for a game.
 *
 * The stored dictionary row keeps all processed fields. This function builds the
 * entry-level and sense-level field selections, removes unselected fields from
 * the returned copy, and throws when the selected fields have nothing displayable
 * for the requested word.
 */
export async function getWordRecord(
    word: string,
    sharedLexicalFields: TrueJSON<SelectableSharedLexicalKey> = {},
    exclusiveSenseLexicalFields: TrueJSON<SelectableExclusiveSenseLexicalKey> = {},
    exclusiveEntryLexicalFields: TrueJSON<SelectableExclusiveEntryLexicalKey> = {}
): Promise<WordRecord> {
    const queryWord = word.toLowerCase();

    const result = await db.query.dictionary.findFirst({
        columns: {
            word: true,
            lexicalEntries: true,
        },
        where: {
            word: queryWord,
        },
    });

    if (!result) {
        throw new Error(`Word "${queryWord}" does not exist in the dictionary`);
    }

    const selectedEntryLexicalFields = { ...sharedLexicalFields, ...exclusiveEntryLexicalFields };
    const selectedSenseLexicalFields = { ...sharedLexicalFields, ...exclusiveSenseLexicalFields };

    let noEntryLexicalFieldsFound = true;
    let noSenseLexicalFieldsFound = true;

    const processedData = result.lexicalEntries.map((entry) => {
        const { senses, ...rest } = entry;

        const processedRest = Object.fromEntries(
            Object.entries(rest).filter(([key]) => {
                if (!(SELECTABLE_ENTRY_LEXICAL_KEYS_SET.has(key as SelectableEntryLexicalKey))) {
                    return true;
                } else if (key in selectedEntryLexicalFields) {
                    noEntryLexicalFieldsFound = false;
                    return true;
                }
                return false;
            })
        ) as typeof rest;

        const { rootNodes, foundSenseLexicalFields } = processGlossNodes(senses, selectedSenseLexicalFields);

        noSenseLexicalFieldsFound = noSenseLexicalFieldsFound && foundSenseLexicalFields.size === 0;

        return {
            senses: rootNodes,
            ...processedRest,
        };
    });


    // A record must expose at least one selected field to be playable/displayable.
    if (noEntryLexicalFieldsFound && noSenseLexicalFieldsFound) {
        throw new Error(
            `For word "${queryWord}", none of the requested lexical fields (${[...Object.keys(sharedLexicalFields), ...Object.keys(exclusiveSenseLexicalFields)].join(', ')}) were found on the entries or their senses`
        );
    }

    return { word: result.word, lexicalEntries: processedData };
}



/**
 * Remove unselected sense-level fields from a gloss tree.
 *
 * The seed step has already built nested gloss nodes. Query-time filtering keeps
 * that tree shape and tracks whether any requested sense field was present so
 * callers can reject empty records.
 */
function processGlossNodes(
    rootNodes: GlossNode[],
    senseLexicalFields: TrueJSON<SelectableSenseLexicalKey>
): { rootNodes: GlossNode[]; foundSenseLexicalFields: Set<SelectableSenseLexicalKey> } {
    const nodesToProcess = [...rootNodes];
    const foundSenseLexicalFields = new Set<SelectableSenseLexicalKey>();

    // DFS mutates the returned record copy so nested gloss nodes keep only selected fields.
    while (nodesToProcess.length > 0) {
        const node = nodesToProcess.pop()!;

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




// const entries = await getWordRecord("man", {synonyms: true}, { glosses: true }, {});

// entries[0].senses[0].
// entries[0].senses[0].examples;
// console.log(entries);
