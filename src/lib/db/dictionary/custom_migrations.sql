CREATE OR REPLACE FUNCTION "dictionary".flatten_lexical_blob(input_data jsonb) 
RETURNS jsonb AS $$
DECLARE
    result jsonb;
BEGIN
    -- This uses JSONPath to find all objects at any depth (**) 
    -- that have both 'w' and 'l' keys => RichToken (see web/src/lib/db/dictionary/types.ts).
    SELECT jsonb_agg(DISTINCT val) INTO result
    FROM jsonb_path_query(
        input_data, 
        '$.** ? (exists (@.w) && exists (@.l))'
    ) AS val;

    RETURN COALESCE(result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql IMMUTABLE;