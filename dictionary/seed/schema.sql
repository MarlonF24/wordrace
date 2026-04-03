CREATE TABLE `dictionary` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`raw_data` blob,
	`word` text GENERATED ALWAYS AS (json_extract(raw_data, '$.word')) VIRTUAL NOT NULL,
	`pos` text GENERATED ALWAYS AS (json_extract(raw_data, '$.pos')) VIRTUAL NOT NULL,
	`senses` text GENERATED ALWAYS AS (json_extract(raw_data, '$.senses')) VIRTUAL NOT NULL,
	`categories` text GENERATED ALWAYS AS (COALESCE(json_extract(raw_data, '$.categories'), '[]')) VIRTUAL NOT NULL,
	`topics` text GENERATED ALWAYS AS (json_extract(raw_data, '$.topics')) VIRTUAL,
	`etymology_text` text GENERATED ALWAYS AS (json_extract(raw_data, '$.etymology.text')) VIRTUAL,
	`synonyms` text GENERATED ALWAYS AS (COALESCE(json_extract(raw_data, '$.?'), '[]')) VIRTUAL NOT NULL,
	`antonyms` text GENERATED ALWAYS AS (COALESCE(json_extract(raw_data, '$.?'), '[]')) VIRTUAL NOT NULL,
	`hypernyms` text GENERATED ALWAYS AS (COALESCE(json_extract(raw_data, '$.?'), '[]')) VIRTUAL NOT NULL,
	`hyponyms` text GENERATED ALWAYS AS (COALESCE(json_extract(raw_data, '$.?'), '[]')) VIRTUAL NOT NULL,
	`holonyms` text GENERATED ALWAYS AS (COALESCE(json_extract(raw_data, '$.?'), '[]')) VIRTUAL NOT NULL,
	`meronyms` text GENERATED ALWAYS AS (COALESCE(json_extract(raw_data, '$.?'), '[]')) VIRTUAL NOT NULL,
	`derived` text GENERATED ALWAYS AS (COALESCE(json_extract(raw_data, '$.?'), '[]')) VIRTUAL NOT NULL,
	`related` text GENERATED ALWAYS AS (COALESCE(json_extract(raw_data, '$.?'), '[]')) VIRTUAL NOT NULL,
	`coordinate_terms` text GENERATED ALWAYS AS (COALESCE(json_extract(raw_data, '$.?'), '[]')) VIRTUAL NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_word` ON `dictionary` (`word`);