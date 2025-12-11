CREATE OR REPLACE FUNCTION jsonb_ensure_path(
    data jsonb,
    path text[]
)
RETURNS jsonb AS $$
DECLARE
    i int;
    current_path text[];
BEGIN
    -- Walk through each level of the path (except the last element)
    -- and ensure parent objects exist
    FOR i IN 1..array_length(path, 1) - 1 LOOP
        current_path := path[1:i];
        
        -- If this level doesn't exist or isn't an object, create an empty object
        IF (data #> current_path) IS NULL OR jsonb_typeof(data #> current_path) != 'object' THEN
            data := jsonb_set(data, current_path, '{}'::jsonb, true);
        END IF;
    END LOOP;
    
    RETURN data;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION jsonb_ensure_path(jsonb, text[]) IS 
'Ensures all parent objects in a JSONB path exist. Creates empty objects for missing path segments.';