BEGIN;

-- Temp table to track rolled-back sheets
CREATE TEMP TABLE temp_rolled_back_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Rollback function for item grids
CREATE OR REPLACE FUNCTION rollback_itemgrid(grid_path text) 
RETURNS integer 
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    updated_rows integer := 0;
    layout_path text[];
    items_exist boolean;
    colocated_layouts_exist boolean;
BEGIN
    layout_path := string_to_array(grid_path, '.');
    
    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> (layout_path || ARRAY['items']) IS NOT NULL
    LOOP
        items_exist := rec.content #> (layout_path || ARRAY['items']) IS NOT NULL;
        colocated_layouts_exist := rec.content #> (layout_path || ARRAY['layouts']) IS NOT NULL;
        
        -- Move layouts back to top level first (if they exist)
        IF colocated_layouts_exist THEN
            -- Ensure top-level layouts object exists
            UPDATE character_sheets
            SET content = CASE 
                WHEN content ? 'layouts' THEN content
                ELSE jsonb_set(content, ARRAY['layouts'], '{}'::jsonb, true)
            END
            WHERE id = rec.id AND NOT (content ? 'layouts');
            
            -- Move co-located layouts to top level
            UPDATE character_sheets
            SET content = jsonb_set(
                content,
                ARRAY['layouts'] || layout_path,
                content #> (layout_path || ARRAY['layouts']),
                true
            )
            WHERE id = rec.id;
        END IF;
        
        -- Unwrap items - replace grid with its items content
        IF items_exist THEN
            UPDATE character_sheets
            SET content = jsonb_set(
                content,
                layout_path,
                content #> (layout_path || ARRAY['items']),
                true
            )
            WHERE id = rec.id;
            
            updated_rows := updated_rows + 1;
            
            INSERT INTO temp_rolled_back_sheets(id) 
            VALUES (rec.id) 
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
    
    RETURN updated_rows;
END;
$$;

-- Rollback melee tabs first (most nested)
CREATE OR REPLACE FUNCTION rollback_melee_tabs() 
RETURNS integer 
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    melee_key text;
    updated_rows integer := 0;
BEGIN
    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> ARRAY['melee-attack', 'items'] IS NOT NULL
    LOOP
        FOR melee_key IN
            SELECT jsonb_object_keys(rec.content #> ARRAY['melee-attack', 'items'])
        LOOP
            -- Check if tabs are wrapped with items structure
            IF rec.content #> ARRAY['melee-attack', 'items', melee_key, 'tabs', 'items'] IS NOT NULL
            THEN
                UPDATE character_sheets
                SET content = jsonb_set(
                    content,
                    ARRAY['melee-attack', 'items', melee_key, 'tabs'],
                    content #> ARRAY['melee-attack', 'items', melee_key, 'tabs', 'items'],
                    true
                )
                WHERE id = rec.id;
                
                updated_rows := updated_rows + 1;
            END IF;
        END LOOP;
        
        INSERT INTO temp_rolled_back_sheets(id) 
        VALUES (rec.id) 
        ON CONFLICT DO NOTHING;
    END LOOP;
    
    RETURN updated_rows;
END;
$$;

SELECT rollback_melee_tabs() AS melee_tabs_rolled_back;

-- Rollback nested grids first
SELECT rollback_itemgrid('techno-arcana.tech-powers') AS tech_rolled_back;
SELECT rollback_itemgrid('psykana.psychic-powers') AS psychic_rolled_back;
SELECT rollback_itemgrid('experience.experience-log') AS exp_log_rolled_back;

-- Rollback top-level grids
SELECT rollback_itemgrid('diseases') AS diseases_rolled_back;
SELECT rollback_itemgrid('mental-disorders') AS mental_disorders_rolled_back;
SELECT rollback_itemgrid('mutations') AS mutations_rolled_back;
SELECT rollback_itemgrid('cybernetics') AS cybernetics_rolled_back;
SELECT rollback_itemgrid('gear') AS gear_rolled_back;
SELECT rollback_itemgrid('talents') AS talents_rolled_back;
SELECT rollback_itemgrid('traits') AS traits_rolled_back;
SELECT rollback_itemgrid('melee-attack') AS melee_attack_rolled_back;
SELECT rollback_itemgrid('ranged-attack') AS ranged_attack_rolled_back;
SELECT rollback_itemgrid('power-shields') AS power_shields_rolled_back;
SELECT rollback_itemgrid('resource-trackers') AS resource_trackers_rolled_back;
SELECT rollback_itemgrid('notes') AS notes_rolled_back;
SELECT rollback_itemgrid('custom-skills') AS custom_skills_rolled_back;

-- Decrement version for rolled-back sheets
UPDATE character_sheets
SET version = version - 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_rolled_back_sheets);

-- Summary
SELECT COUNT(*) AS total_rolled_back 
FROM temp_rolled_back_sheets;

-- Cleanup
DROP FUNCTION rollback_itemgrid(text);
DROP FUNCTION rollback_melee_tabs();

COMMIT;