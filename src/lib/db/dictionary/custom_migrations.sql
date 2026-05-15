CREATE OR REPLACE FUNCTION flatten_lexical_blob_mapped(input_data jsonb, filter_keys text[]) 
RETURNS jsonb AS $$
DECLARE
    result jsonb;
    k text;
    vals jsonb;
BEGIN
    result := '{}'::jsonb;
    
    FOREACH k IN ARRAY filter_keys LOOP
        SELECT jsonb_build_object(
            'w', jsonb_agg(DISTINCT (val->>'w')),
            'l', jsonb_agg(DISTINCT (val->>'l'))
        ) INTO vals
        FROM jsonb_path_query(
            input_data, 
            ('$.**.' || quote_ident(k) || '.** ? (exists (@.w) && exists (@.l))')::jsonpath
        ) AS val;
        
        IF vals IS NOT NULL AND (vals->'w') != 'null'::jsonb THEN
            result := result || jsonb_build_object(k, vals);
        END IF;
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE; 