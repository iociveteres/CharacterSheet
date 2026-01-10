BEGIN;

-- Temp table to track migrated sheets
CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Function to wrap powers into tabs
CREATE OR REPLACE FUNCTION migrate_powers_to_tabs(
    container_path text,
    powers_key text,
    tab_name text
) 
RETURNS integer 
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    updated_rows integer := 0;
    container_path_arr text[];
    powers_exist boolean;
    tabs_exist boolean;
    tab_id text;
BEGIN
    container_path_arr := string_to_array(container_path, '.');
    tab_id := 'tab-' || gen_random_uuid()::text;
    
    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> (container_path_arr || ARRAY[powers_key]) IS NOT NULL
    LOOP
        tabs_exist := rec.content #> (container_path_arr || ARRAY['tabs', 'items']) IS NOT NULL;
        powers_exist := rec.content #> (container_path_arr || ARRAY[powers_key, 'items']) IS NOT NULL;
        
        -- Only migrate if tabs don't already exist and powers do
        IF NOT tabs_exist AND powers_exist THEN
            -- Create tab structure with "General" tab containing existing powers
            UPDATE character_sheets
            SET content = jsonb_set(
                -- Remove old powers_key
                content #- (container_path_arr || ARRAY[powers_key]),
                -- Set new tabs structure
                container_path_arr || ARRAY['tabs'],
                jsonb_build_object(
                    'items', jsonb_build_object(
                        tab_id, jsonb_build_object(
                            'name', tab_name,
                            'powers', rec.content #> (container_path_arr || ARRAY[powers_key])
                        )
                    ),
                    'layouts', jsonb_build_object(
                        tab_id, jsonb_build_object(
                            'colIndex', 0,
                            'rowIndex', 0
                        )
                    )
                ),
                true
            )
            WHERE id = rec.id;
            
            updated_rows := updated_rows + 1;
            
            INSERT INTO temp_migrated_sheets(id) 
            VALUES (rec.id) 
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
    
    RETURN updated_rows;
END;
$$;

-- Migrate psychic powers
SELECT migrate_powers_to_tabs('psykana', 'psychic-powers', 'General') 
AS psychic_powers_migrated;

-- Migrate tech powers
SELECT migrate_powers_to_tabs('techno-arcana', 'tech-powers', 'General') 
AS tech_powers_migrated;

-- Bump version for migrated sheets
UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

-- Summary
SELECT COUNT(*) AS total_migrated 
FROM temp_migrated_sheets;

-- Cleanup
DROP FUNCTION migrate_powers_to_tabs(text, text, text);

COMMIT;