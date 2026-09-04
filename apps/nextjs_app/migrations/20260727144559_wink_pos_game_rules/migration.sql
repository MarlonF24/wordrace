DELETE FROM "game_player_link";
--> statement-breakpoint
DELETE FROM "games";
--> statement-breakpoint
TRUNCATE TABLE "dictionary"."dummy_table";
--> statement-breakpoint
CREATE TYPE "dictionary"."wink_pos_tag" AS ENUM('ADJ', 'ADP', 'ADV', 'AUX', 'CCONJ', 'DET', 'INTJ', 'NOUN', 'NUM', 'PART', 'PRON', 'PROPN', 'PUNCT', 'SCONJ', 'SYM', 'VERB', 'X', 'SPACE');--> statement-breakpoint
ALTER TYPE "dictionary"."selectable_lexical_keys" RENAME TO "selectable_lexical_key";--> statement-breakpoint
ALTER TYPE "dictionary"."wiktionary_pos_tags" RENAME TO "wiktionary_pos_tag";--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "available_pos" jsonb DEFAULT '{"ADJ":true,"ADP":true,"ADV":true,"AUX":true,"CCONJ":true,"DET":true,"INTJ":true,"NOUN":true,"NUM":true,"PART":true,"PRON":true,"PROPN":true,"PUNCT":true,"SCONJ":true,"SYM":true,"VERB":true,"X":true,"SPACE":true}' NOT NULL;--> statement-breakpoint
ALTER TABLE "dictionary"."dummy_table" ADD COLUMN "wink_pos_tags_dummy" "dictionary"."wink_pos_tag";--> statement-breakpoint
ALTER TABLE "games" DROP COLUMN "pos_filter_enabled";--> statement-breakpoint
ALTER TABLE "dictionary"."dummy_table" DROP CONSTRAINT "dummy_table_pkey";--> statement-breakpoint
ALTER TABLE "dictionary"."dummy_table" ADD PRIMARY KEY ("selectable_lexical_keys_dummy","wiktionary_pos_tags_dummy","wink_pos_tags_dummy");
