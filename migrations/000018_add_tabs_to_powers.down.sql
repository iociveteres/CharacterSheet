BEGIN;

-- Temp table to track rolled-back sheets
CREATE TEMP TABLE temp_rolled_back_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Function to unwrap tabs back to direct powers
CREATE OR REPLACE FUNCTION rollback_tabs_to_powers(
    container_path text,
    powers_key text
) 
RETURNS integer 
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    updated_rows integer := 0;
    container_path_arr text[];
    tabs_exist boolean;
    first_tab_id text;
    first_tab_powers jsonb;
BEGIN
    container_path_arr := string_to_array(container_path, '.');
    
    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> (container_path_arr || ARRAY['tabs', 'items']) IS NOT NULL
    LOOP
        -- Get the first tab's powers (assume "General" tab has all powers)
        SELECT key INTO first_tab_id
        FROM jsonb_object_keys(rec.content #> (container_path_arr || ARRAY['tabs', 'items'])) AS key
        LIMIT 1;
        
        IF first_tab_id IS NOT NULL THEN
            first_tab_powers := rec.content #> (container_path_arr || ARRAY['tabs', 'items', first_tab_id, 'powers']);
            
            IF first_tab_powers IS NOT NULL THEN
                -- Restore old structure
                UPDATE character_sheets
                SET content = jsonb_set(
                    -- Remove tabs
                    content #- (container_path_arr || ARRAY['tabs']),
                    -- Set powers back to top level
                    container_path_arr || ARRAY[powers_key],
                    first_tab_powers,
                    true
                )
                WHERE id = rec.id;
                
                updated_rows := updated_rows + 1;
                
                INSERT INTO temp_rolled_back_sheets(id) 
                VALUES (rec.id) 
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;
    
    RETURN updated_rows;
END;
$$;

-- Rollback psychic powers
SELECT rollback_tabs_to_powers('psykana', 'psychic-powers') 
AS psychic_powers_rolled_back;

-- Rollback tech powers
SELECT rollback_tabs_to_powers('techno-arcana', 'tech-powers') 
AS tech_powers_rolled_back;

-- Decrement version for rolled-back sheets
UPDATE character_sheets
SET version = version - 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_rolled_back_sheets);

-- Summary
SELECT COUNT(*) AS total_rolled_back 
FROM temp_rolled_back_sheets;

-- Cleanup
DROP FUNCTION rollback_tabs_to_powers(text, text);

COMMIT;