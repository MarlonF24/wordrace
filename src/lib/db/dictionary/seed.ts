import pg from 'pg';
import { from as copyFrom, to as copyTo } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { dictionary, dictionaryRaw, words } from './schema';
import { getTableUniqueName } from 'drizzle-orm';
import { tokenizeToRichText } from '@/lib/lemmatisation';
import { stringify } from 'csv-stringify';
import split2 from 'split2';
import { setCorrUnionField } from '@/lib/utils';

import {
    SELECTABLE_ENTRY_LEXICAL_KEYS,
    SELECTABLE_SENSE_LEXICAL_KEYS,
    OBJECT_FIELDS_TO_PRINT,
    type RawEntry,
    type ProcessedFlatObjectlexicalField,
    type FlatObjectSelectableLexicalFields,
    type FlatObjectSelectableLexicalKey,
    type RichText,
    type SelectableLexicalFields,
    type RawLexicalFields,
    type RawSense,
    type GlossNode,
    type RawSenseLexicalFields,
    type SelectableSenseLexicalKey,
    LexicalEntry,
} from './types';

const dbConfig = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};



// include schema: schema.name
const fullDictionaryName = getTableUniqueName(dictionary);
const fullDictionaryRawName = getTableUniqueName(dictionaryRaw);
const fullWordsName = getTableUniqueName(words);

console.debug('Dictionary table name:', fullDictionaryName);
console.debug('Dictionary raw table name:', fullDictionaryRawName);

async function loadRawData(jsonlPath: string = process.env.SEED_DATA_PATH!, minRowsForAbort: number = 1454988) {
    if (!jsonlPath) throw new Error(`Path ${jsonlPath} is not set.`);

    const client = new pg.Client(dbConfig);
    await client.connect();


    const res = await client.query(`SELECT COUNT(*) FROM ${fullDictionaryRawName}`);
    const count = res.rows[0].count;
    if (count >= minRowsForAbort) {
        console.log(`Found ${count} which is greater than or equal to minRowsForAbort (${minRowsForAbort}) entries in ${fullDictionaryRawName}. Not touching table.`);
        await client.end();
        return;
    }

    console.log(`Found ${count} < minRowsForAbort (${minRowsForAbort}): Truncating ${fullDictionaryRawName}...`);
    await client.query(`TRUNCATE TABLE ${fullDictionaryRawName} RESTART IDENTITY`);


    console.log('Streaming JSONL to Postgres...');
    const copyStream = client.query(
        copyFrom(
            `COPY ${fullDictionaryRawName} (${dictionaryRaw.raw_data.name}) FROM STDIN WITH (FORMAT csv, QUOTE e'\\x01', DELIMITER e'\\x02')`
        )
    );

    await pipeline(createReadStream(jsonlPath), copyStream);

    await client.end();
    console.log('Raw data loaded.');
}

async function hydrateWithProcessing(reseedWords: boolean = false, minRowsForAbort: number = 1454988) {
    
    const client = new pg.Client(dbConfig);
    await client.connect();
    const res = await client.query(`SELECT COUNT(*) FROM ${fullDictionaryName}`);
    const count = res.rows[0].count;
    
    if (count >= minRowsForAbort) {
        console.log(`Found ${count} which is greater than or equal to minRowsForAbort (${minRowsForAbort}) entries in ${fullDictionaryName}. Not touching table.`);
        await client.end();
        return;
    }

    console.log(`Found ${count} < minRowsForAbort (${minRowsForAbort}): Truncating ${fullDictionaryName}...`);
    await client.query(`TRUNCATE TABLE ${fullDictionaryName} RESTART IDENTITY`);

    const readerClient = new pg.Client(dbConfig);
    const writerClient = new pg.Client(dbConfig);

    try {
        await Promise.all([readerClient.connect(), writerClient.connect()]);

        // Quickly deactivate FKs and triggers for bulk load
        if (reseedWords) {
            await writerClient.query(`ALTER TABLE ${fullDictionaryName} DISABLE TRIGGER ALL`);
            await writerClient.query(`TRUNCATE TABLE ${fullWordsName} RESTART IDENTITY CASCADE`);
        }

        console.log('Processing and hydrating...');

        const exportStream = readerClient.query(
            copyTo(
                `COPY (
                    SELECT jsonb_agg(${dictionaryRaw.raw_data.name}) 
                    FROM ${fullDictionaryRawName} 
                    GROUP BY LOWER(${dictionaryRaw.raw_data.name}->>'word')
                ) TO STDOUT WITH (FORMAT csv, QUOTE e'\\x01', DELIMITER e'\\x02')`
            )
        );
        const importStream = writerClient.query(
            copyFrom(
                `COPY ${fullDictionaryName} FROM STDIN WITH (FORMAT csv)`
            )
        );

    
        await pipeline(
            exportStream,
            split2(),
            async function* (source) {
                let count = 0;
                for await (const chunk of source) {
                    const chunkStr = chunk.toString().trim();
                    if (!chunkStr) continue;

                    try {
                        const raw = JSON.parse(chunkStr) as RawEntry[]; // all entries for some word
                        
                        const processedEntry = {
                            word: raw[0].word.toLowerCase(),
                            data: JSON.stringify(raw.map((entry) => processRawEntry(entry))),
                        }

                        yield processedEntry;

                        count++;
                        if (count % 1000 === 0) {
                            process.stdout.write(`\rProcessed ${count} entries...\n`);
                        }
                    } catch (err) {
                        console.error(
                            `Error processing entry ${count + 1}: ${err instanceof Error ? err.message : String(err)}. Skipping.`
                        );
                    }
                }
                process.stdout.write(`\nFinished processing ${count} entries.\n`);
            },
            stringify({
                header: false,
                quoted: true,
            }),
            importStream
        );

        if (reseedWords) {
            console.log(`Populating ${fullWordsName} from ${fullDictionaryName}...`);
            await writerClient.query(`
                INSERT INTO ${fullWordsName} (word)
                SELECT DISTINCT word FROM ${fullDictionaryName}
                ON CONFLICT DO NOTHING
            `);
        }

        // Re-enable triggers and FKs
        await writerClient.query(`ALTER TABLE ${fullDictionaryName} ENABLE TRIGGER ALL`);

    } finally {
        await Promise.allSettled([readerClient.end(), writerClient.end()]);
    }
}



/**
 * Convert one raw Kaikki entry into the processed entry shape stored by the app.
 *
 * Entry-level lexical fields are copied when supported, while senses are
 * normalized into a nested gloss tree with rich-token text.
 */
export function processRawEntry(rawEntry: RawEntry): LexicalEntry {
    const entryLexicalFields = processObjectLexicalFields(rawEntry, SELECTABLE_ENTRY_LEXICAL_KEYS);

    const processedSenses = processSenses(rawEntry.senses);

    return {
        pos: rawEntry.pos,
        senses: processedSenses,
        ...entryLexicalFields,
    };
}

/**
 * Convert the selected object-valued lexical fields on one raw entry or sense.
 *
 * The helper keeps the correlation between a lexical key and its value shape,
 * then delegates tokenization of printable object fields to
 * `processObjectLexicalField`.
 */
function processObjectLexicalFields<T extends FlatObjectSelectableLexicalKey>(
    rawObj: Partial<Pick<RawLexicalFields, T>>,
    lexicalKeys: readonly T[]
) {
    return lexicalKeys.reduce(
        (acc, lexicalKey) => {
            const lexVal = rawObj[lexicalKey];
            if (lexVal) {
                setCorrUnionField(acc, lexicalKey, processObjectLexicalField(lexVal, lexicalKey));
            }
            return acc;
        },
        {} as Partial<Pick<SelectableLexicalFields, T>>
    );
}

/**
 * Convert one object-valued lexical field into display-ready rich text.
 *
 * Only fields listed in `OBJECT_FIELDS_TO_PRINT` are rendered; each configured
 * string field is tokenized so game UI can turn words into links.
 */
function processObjectLexicalField<K extends FlatObjectSelectableLexicalKey>(
    lexVal: RawLexicalFields[K],
    lexicalKey: K
): SelectableLexicalFields[K] {
    // for now well write the code for the current state, where all selectable lexical field values are object[] and thus all selectable lexical fields are in FlatObjectSelectableLexicalFields.

    // const items = Array.isArray(lexVal) ? lexVal : [lexVal];

    if (!(lexicalKey in OBJECT_FIELDS_TO_PRINT))
        throw new Error(
            `Extra key ${lexicalKey} does not map to object or object[] and is thus not in OBJECT_FIELDS_TO_PRINT, rn 'processObjectLexicalField' only supports lexical fields whose values are objects or arrays of objects. Gotta edit this function if you want to support non-object lexical fields like string or string[].`
        );

        
        const fieldsToPrint = OBJECT_FIELDS_TO_PRINT[lexicalKey];
        
        const result = lexVal.map((item) => {
            const processedItem = Object.fromEntries(
                fieldsToPrint.reduce(
                    (entries, printKey) => {
                        if (printKey in item) {
                            const val = (item as FlatObjectSelectableLexicalFields[K])[
                                printKey
                            ] as string;
                            entries.push([printKey, tokenizeToRichText(val)]);
                        }
                        return entries;
                    },
                    [] as [keyof FlatObjectSelectableLexicalFields[K], RichText][]
                )
            ) as ProcessedFlatObjectlexicalField<K>;
            
            return processedItem;
        });
        
    if (lexicalKey === "examples") {
        // console.log("examples in processObjectLexicalField", lexVal);
    }
    return result as SelectableLexicalFields[K];
}

/**
 * Build a gloss tree from the ordered raw Wiktionary sense list.
 *
 * Raw child senses repeat their parent gloss path. The processed tree stores
 * shared gloss text on the highest common node and only keeps each child's
 * additional text/fields on that child.
 */
export function processSenses(senses: RawSense[]): GlossNode[] {
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

    const rootLevel: GlossNode[] = [];
    const lastEncountered: { glossNode: GlossNode; sense: RawSense }[] = []; // stores the last encountered gloss node for level i at [][i]

    for (const sense of senses) {
        const depth = sense.glosses ? sense.glosses.length : 1; // if no glosses, we consider it as a root level node with an empty gloss. There might be an edge case where a non-gloss sense has a non-gloss child and should technically go into a different depth but that would be too expensive to detect and too rare.

        if (depth === 0)
            throw new Error(
                'Sense with empty array ([]) of glosses encountered in processSenses. Expect at least one gloss in the array or no array at all.'
            );

        // if not root level, grab parent
        const parent = depth > 1 ? lastEncountered[depth - 1] : undefined;
        const parentSense = parent?.sense;
        const parentGlossNode = parent?.glossNode;

        // initialise glossnode
        const node: GlossNode = {
            children: [],
            lexicalFields: {}, // grab last sense as thats always the diff
        };

        // compute diff (even if no parent, cause it also filters to grab only object lexical fields)
        const diffObjectSenseLexicalFields = getDiffObjectSenseLexicalFields(sense, parentSense);

        // process lexical fields
        node.lexicalFields = processObjectLexicalFields(
            diffObjectSenseLexicalFields,
            Object.keys(diffObjectSenseLexicalFields) as (keyof typeof diffObjectSenseLexicalFields)[]
        );

        // set gloss (if theres a parent and it has glosses, cut those off the start)
        const parentGlossLength = parentSense?.glosses ? parentSense.glosses.length : 0;
        node.lexicalFields.glosses = sense.glosses
            ? tokenizeToRichText(sense.glosses.slice(parentGlossLength).join(' '))
            : undefined;

        // attach to parent or root
        if (parentGlossNode) {
            parentGlossNode.children.push(node);
        } else {
            // sometimes even with depth > 1 there is no parent
            rootLevel.push(node);
        }

        lastEncountered[depth] = { glossNode: node, sense };
    }

    return rootLevel;
}

/**
 * Return object-valued sense fields that are new relative to the parent sense.
 *
 * Wiktionary child senses usually repeat parent lexical arrays. This function
 * removes those repeated prefixes so nested UI nodes only display new data.
 */
function getDiffObjectSenseLexicalFields(sense: RawSense, parentSense?: RawSense) {
    /* 
    Extract object lexical fields. Given a parentSense, leave only the difference in those to the parent.
    */

    const diffObjectSenseLexicalFields: Partial<
        Pick<RawSenseLexicalFields, Extract<SelectableSenseLexicalKey, FlatObjectSelectableLexicalKey>>
    > = {}; // in the RawSense, children senses usually repeat everything in the parent sense, so we only want to keep the differences for every field

    for (const senseLexicalKey of SELECTABLE_SENSE_LEXICAL_KEYS) {
        if (senseLexicalKey === 'glosses') continue; // rn only non object selectable lexical sense key, might need to add more in the future

        const val = sense[senseLexicalKey];
        if (val === undefined) continue;

        const parentVal = parentSense ? parentSense[senseLexicalKey] : undefined;

        if (!parentVal) {
            // if no parent sense or no parent value, just take whats there
            setCorrUnionField(diffObjectSenseLexicalFields, senseLexicalKey, val);
            continue;
        }

        const parentType = typeof parentVal;
        const valType = typeof val;

        if (valType !== parentType) {
            throw new Error(
                `Type mismatch between parent and child sense for key ${senseLexicalKey} whilst diffing in processSenses. Parent type: ${parentType}, Child type: ${valType}. This should not happen as the data structure is consistent, but if it does, gotta handle it in the code.`
            );
        }

        if (Array.isArray(val) && Array.isArray(parentVal)) {
            const diff = val.slice(parentVal.length); // we assume that the child always contains everything in the parent, so thats what we cut off at the start

            if (diff.length > 0) setCorrUnionField(diffObjectSenseLexicalFields, senseLexicalKey, diff);
        } else if (JSON.stringify(parentVal) !== JSON.stringify(val)) {
            // if only object
            setCorrUnionField(diffObjectSenseLexicalFields, senseLexicalKey, val);
        }
    }

    return diffObjectSenseLexicalFields;
}
if (process.env.NODE_ENV === 'production') {
    await loadRawData();
    await hydrateWithProcessing(true);
} else {
    // await loadRawData();
    await hydrateWithProcessing(false, 100000000);
}
