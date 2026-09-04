CREATE SCHEMA "dictionary";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION dictionary.flatten_lexical_blob_mapped(input_data jsonb, filter_keys text[])
RETURNS jsonb AS $$
DECLARE
    result jsonb;
    k text;
    pos_vals record;
BEGIN
    -- 1. Initialize the root with 'w' and 'l' keys
    result := '{"w": {}, "l": {}}'::jsonb;
    
    FOREACH k IN ARRAY filter_keys LOOP
        FOR pos_vals IN
            SELECT
                val->>'p' AS pos,
                jsonb_agg(DISTINCT (val->>'w')) AS w_vals,
                jsonb_agg(DISTINCT (val->>'l')) AS l_vals
            FROM jsonb_path_query(
                input_data, 
                ('$.**.' || quote_ident(k) || '.** ? (exists (@.w) && exists (@.l) && exists (@.p))')::jsonpath
            ) AS val
            WHERE val->>'p' IS NOT NULL
            GROUP BY val->>'p'
        LOOP
            -- 2. Initialize the lexical key intermediate paths if they don't exist yet
            -- (Doing this inside the loop prevents generating empty objects for keys that have no data)
            IF NOT result->'w' ? k THEN
                result := jsonb_set(result, ARRAY['w', k], '{}'::jsonb, true);
                result := jsonb_set(result, ARRAY['l', k], '{}'::jsonb, true);
            END IF;

            -- 3. Route the aggregated arrays to their new respective paths
            result := jsonb_set(result, ARRAY['w', k, pos_vals.pos], pos_vals.w_vals, true);
            result := jsonb_set(result, ARRAY['l', k, pos_vals.pos], pos_vals.l_vals, true);
        END LOOP;
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
