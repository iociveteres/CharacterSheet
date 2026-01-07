BEGIN;

-- Temp table to track migrated sheets
CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Migration function
CREATE OR REPLACE FUNCTION migrate_to_itemgrid(grid_path text) 
RETURNS integer 
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    updated_rows integer := 0;
    layout_path text[];
    items_exist boolean;
    layouts_exist boolean;
BEGIN
    layout_path := string_to_array(grid_path, '.');
    
    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> layout_path IS NOT NULL
    LOOP
        -- Check if items already exist (already migrated or new data)
        items_exist := rec.content #> (layout_path || ARRAY['items']) IS NOT NULL;
        
        -- Check if old-style layouts exist
        layouts_exist := rec.content #> (ARRAY['layouts'] || layout_path) IS NOT NULL;
        
        -- Only migrate if NOT already in new format
        IF NOT items_exist THEN
            -- Wrap existing items in "items" key
            UPDATE character_sheets
            SET content = jsonb_set(
                content,
                layout_path || ARRAY['items'],
                content #> layout_path,
                true
            )
            WHERE id = rec.id;
            
            updated_rows := updated_rows + 1;
            
            INSERT INTO temp_migrated_sheets(id) 
            VALUES (rec.id) 
            ON CONFLICT DO NOTHING;
        END IF;
        
        -- Move layouts from top-level to co-located (if they exist)
        IF layouts_exist THEN
            UPDATE character_sheets
            SET content = jsonb_set(
                jsonb_set(
                    content,
                    layout_path || ARRAY['layouts'],
                    content #> (ARRAY['layouts'] || layout_path),
                    true
                ),
                ARRAY['layouts'],
                (content -> 'layouts') - grid_path,
                false
            )
            WHERE id = rec.id;
        END IF;
    END LOOP;
    
    RETURN updated_rows;
END;
$$;

-- Migrate all grids
SELECT migrate_to_itemgrid('custom-skills') AS custom_skills_migrated;
SELECT migrate_to_itemgrid('notes') AS notes_migrated;
SELECT migrate_to_itemgrid('resource-trackers') AS resource_trackers_migrated;
SELECT migrate_to_itemgrid('power-shields') AS power_shields_migrated;
SELECT migrate_to_itemgrid('ranged-attack') AS ranged_attack_migrated;
SELECT migrate_to_itemgrid('melee-attack') AS melee_attack_migrated;
SELECT migrate_to_itemgrid('traits') AS traits_migrated;
SELECT migrate_to_itemgrid('talents') AS talents_migrated;
SELECT migrate_to_itemgrid('gear') AS gear_migrated;
SELECT migrate_to_itemgrid('cybernetics') AS cybernetics_migrated;
SELECT migrate_to_itemgrid('mutations') AS mutations_migrated;
SELECT migrate_to_itemgrid('mental-disorders') AS mental_disorders_migrated;
SELECT migrate_to_itemgrid('diseases') AS diseases_migrated;

-- Nested grids
SELECT migrate_to_itemgrid('experience.experience-log') AS exp_log_migrated;
SELECT migrate_to_itemgrid('psykana.psychic-powers') AS psychic_migrated;
SELECT migrate_to_itemgrid('techno-arcana.tech-powers') AS tech_migrated;

-- Melee attack tabs (nested further)
CREATE OR REPLACE FUNCTION migrate_melee_tabs() 
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
        -- For each melee attack, wrap its tabs
        FOR melee_key IN
            SELECT jsonb_object_keys(rec.content #> ARRAY['melee-attack', 'items'])
        LOOP
            -- Check if tabs exist and aren't already wrapped
            IF rec.content #> ARRAY['melee-attack', 'items', melee_key, 'tabs'] IS NOT NULL
               AND rec.content #> ARRAY['melee-attack', 'items', melee_key, 'tabs', 'items'] IS NULL
            THEN
                UPDATE character_sheets
                SET content = jsonb_set(
                    content,
                    ARRAY['melee-attack', 'items', melee_key, 'tabs'],
                    jsonb_build_object(
                        'items', content #> ARRAY['melee-attack', 'items', melee_key, 'tabs'],
                        'layouts', '{}'::jsonb
                    ),
                    true
                )
                WHERE id = rec.id;
                
                updated_rows := updated_rows + 1;
            END IF;
        END LOOP;
        
        INSERT INTO temp_migrated_sheets(id) 
        VALUES (rec.id) 
        ON CONFLICT DO NOTHING;
    END LOOP;
    
    RETURN updated_rows;
END;
$$;

SELECT migrate_melee_tabs() AS melee_tabs_migrated;

-- Remove empty top-level layouts object
UPDATE character_sheets
SET content = content - 'layouts'
WHERE content -> 'layouts' = '{}'::jsonb;

-- Bump version for migrated sheets
UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

-- Cleanup
DROP FUNCTION migrate_to_itemgrid(text);

COMMIT;