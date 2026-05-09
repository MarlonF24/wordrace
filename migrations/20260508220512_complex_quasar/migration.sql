CREATE TYPE "game_mode" AS ENUM('normal', 'collide');--> statement-breakpoint
CREATE TABLE "game_player_link" (
	"game_id" uuid,
	"player_id" uuid,
	"admin" boolean DEFAULT false NOT NULL,
	"start_links" jsonb NOT NULL,
	"target_links" jsonb NOT NULL,
	"found" boolean GENERATED ALWAYS AS ((start_links -> -1 ->> 'word') = (target_links -> -1 ->> 'word')) STORED NOT NULL,
	"link_count" integer GENERATED ALWAYS AS (jsonb_array_length(start_links) - 1 + jsonb_array_length(target_links) - 1) STORED NOT NULL,
	"duration_ms" bigint GENERATED ALWAYS AS (
    greatest(
      (start_links -> -1 ->> 'timestamp')::bigint - (start_links -> 0 ->> 'timestamp')::bigint,
      (target_links -> -1 ->> 'timestamp')::bigint - (target_links -> 0 ->> 'timestamp')::bigint
    )
  ) STORED NOT NULL,
	CONSTRAINT "game_player_link_pkey" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"start_word" text NOT NULL,
	"target_word" text NOT NULL,
	"mode" "game_mode" DEFAULT 'normal'::"game_mode" NOT NULL,
	"lemmatise" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exclusive_entry_lexical_fields" jsonb DEFAULT '{}' NOT NULL,
	"exclusive_sense_lexical_fields" jsonb DEFAULT '{}' NOT NULL,
	"shared_lexical_fields" jsonb DEFAULT '{}' NOT NULL,
	"entry_lexical_fields" jsonb GENERATED ALWAYS AS ((exclusive_entry_lexical_fields || exclusive_sense_lexical_fields || shared_lexical_fields)) STORED NOT NULL,
	"sense_lexical_fields" jsonb GENERATED ALWAYS AS ((exclusive_sense_lexical_fields || shared_lexical_fields)) STORED NOT NULL,
	"lexical_fields" jsonb GENERATED ALWAYS AS ((exclusive_entry_lexical_fields || exclusive_sense_lexical_fields || shared_lexical_fields)) STORED NOT NULL,
	CONSTRAINT "unique_start_target" CHECK ("start_word" <> "target_word"),
	CONSTRAINT "at_least_one_lexical_field" CHECK ("lexical_fields" <> '{}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictionary"."dictionary" (
	"word" text NOT NULL,
	"pos" text NOT NULL,
	"senses" jsonb NOT NULL,
	"categories" jsonb,
	"synonyms" jsonb,
	"antonyms" jsonb,
	"hypernyms" jsonb,
	"hyponyms" jsonb,
	"holonyms" jsonb,
	"meronyms" jsonb,
	"derived" jsonb,
	"related" jsonb,
	"coordinate_terms" jsonb,
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dictionary"."dictionary_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"all_links" jsonb GENERATED ALWAYS AS ("dictionary".flatten_lexical_blob(
            COALESCE("senses", '[]'::jsonb) || COALESCE("categories", '[]'::jsonb) || COALESCE("synonyms", '[]'::jsonb) || COALESCE("antonyms", '[]'::jsonb) || COALESCE("hypernyms", '[]'::jsonb) || COALESCE("hyponyms", '[]'::jsonb) || COALESCE("holonyms", '[]'::jsonb) || COALESCE("meronyms", '[]'::jsonb) || COALESCE("derived", '[]'::jsonb) || COALESCE("related", '[]'::jsonb) || COALESCE("coordinate_terms", '[]'::jsonb)
        )) STORED,
	CONSTRAINT "lowercase_word" CHECK (word = lower(word))
);
--> statement-breakpoint
CREATE TABLE "dictionary"."dictionary_raw" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dictionary"."dictionary_raw_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"raw_data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictionary"."words" (
	"word" text PRIMARY KEY,
	CONSTRAINT "lowercase_word" CHECK (word = lower(word))
);
--> statement-breakpoint
CREATE INDEX "idx_word" ON "dictionary"."dictionary" ("word");--> statement-breakpoint
ALTER TABLE "game_player_link" ADD CONSTRAINT "game_player_link_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id");--> statement-breakpoint
ALTER TABLE "game_player_link" ADD CONSTRAINT "game_player_link_player_id_players_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id");--> statement-breakpoint
ALTER TABLE "dictionary"."dictionary" ADD CONSTRAINT "dictionary_word_words_word_fkey" FOREIGN KEY ("word") REFERENCES "dictionary"."words"("word");