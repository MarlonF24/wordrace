import { sqliteTable, index, integer, blob, text } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

export const dictionary = sqliteTable("dictionary", {
	id: integer().primaryKey({ autoIncrement: true }),
	rawData: blob({mode: "json"}),
	word: text().generatedAlwaysAs(sql`json_extract(raw_data, '$.word')`, { mode: "virtual" }),
	pos: text().generatedAlwaysAs(sql`json_extract(raw_data, '$.pos')`, { mode: "virtual" }),
	senses: text().generatedAlwaysAs(sql`json_extract(raw_data, '$.senses')`, { mode: "virtual" }),
},
(table) => [index("idx_word").on(table.word),
]);

