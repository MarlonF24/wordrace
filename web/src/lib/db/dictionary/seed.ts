import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { dictionary, dictionaryRaw } from './schema';
import { getColumns, getTableUniqueName } from 'drizzle-orm';

const client = new pg.Client({
    host: process.env.DICT_DB_HOST,
    port: Number(process.env.DICT_DB_PORT),
    user: process.env.DICT_DB_USER,
    password: process.env.DICT_DB_PASSWORD,
    database: process.env.DICT_DB_NAME,
});

// include schema: schema.name
const fullDictionaryName = getTableUniqueName(dictionary);
const fullDictionaryRawName = getTableUniqueName(dictionaryRaw);

console.debug("Dictionary table name:", fullDictionaryName);
console.debug("Dictionary raw table name:", fullDictionaryRawName);


async function loadRawData(jsonlPath: string) {
    await client.connect();
    
    console.log("Truncating raw storage...");
    await client.query(`TRUNCATE TABLE ${fullDictionaryRawName}`);

    console.log("Streaming JSONL to Postgres...");
    const copyStream = client.query(copyFrom(
        `COPY ${fullDictionaryRawName} (${dictionaryRaw.raw_data.name}) FROM STDIN WITH (FORMAT csv, QUOTE e'\\x01', DELIMITER e'\\x02')`
    ));

    await pipeline(createReadStream(jsonlPath), copyStream);

    await client.end();
    console.log("Raw data loaded.");
}

async function hydrateFromRaw() {
    
    await client.connect();

    // if (dictionarySchemaPath) {
    //     console.log("Creating clean table from schema...");
    //     const fullPath = path.resolve(dictionarySchemaPath);
    //     const createTableSQL = await fs.promises.readFile(fullPath, 'utf-8');
    //     await client.query(`TRUNCATE TABLE IF EXISTS ${fullDictionaryName}`);
    //     await client.query(createTableSQL);

    // }
    console.log("Truncating dictionary table...");
    await client.query(`TRUNCATE TABLE ${fullDictionaryName}`);

    const colNames = Object.values(getColumns(dictionary))
    .filter(col => col.name !== "id")
    .map(col => `"${col.name}"`);

    const columnList = colNames.join(', ');
    // We need the columns prefixed with the subquery alias for the outer select
    const aliasedColumnList = colNames.map(name => `(populated).${name}`).join(', ');

    await client.query(`
        INSERT INTO ${fullDictionaryName} (${columnList})
        SELECT ${aliasedColumnList}
        FROM (
            SELECT jsonb_populate_record(NULL::${fullDictionaryName}, ${dictionaryRaw.raw_data.name}) AS populated
            FROM ${fullDictionaryRawName}
        ) AS sub
    `);

    await client.end();

    console.log("Dictionary is ready.");
}

// loadRawData("/home/marlo/repos/WordRace/web/src/lib/db/dictionary/kaikki.org-dictionary-English.jsonl");
// hydrateFromRaw();