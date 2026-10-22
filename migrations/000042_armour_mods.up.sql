BEGIN;

CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- The armour of a gear item has a grid of mods instead of an upgrades text.
-- For a single sheet's content (WithArmourMods in character_sheets_defaults.go
-- does the same on import), each name between the commas of the text becomes
-- a mod with only that name, ids mod-1, mod-2, … in order; an armour that has
-- mods already keeps them. Then the text goes.
CREATE OR REPLACE FUNCTION armour_mods(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    result jsonb := content;
    item_key text;
    armour jsonb;
    typed text;
    mod_name text;
    items jsonb;
    layouts jsonb;
    n int;
BEGIN
    IF jsonb_typeof(content #> '{gear,list,items}') IS DISTINCT FROM 'object' THEN
        RETURN content;
    END IF;

    FOR item_key IN SELECT jsonb_object_keys(content #> '{gear,list,items}')
    LOOP
        armour := content #> ARRAY['gear', 'list', 'items', item_key, 'armour'];
        IF jsonb_typeof(armour) IS DISTINCT FROM 'object' OR NOT armour ? 'upgrades' THEN
            CONTINUE;
        END IF;

        IF COALESCE(jsonb_typeof(armour -> 'mods'), 'null') = 'null' THEN
            typed := CASE WHEN jsonb_typeof(armour -> 'upgrades') = 'string' THEN armour ->> 'upgrades' ELSE '' END;
            items := '{}'::jsonb;
            layouts := '{}'::jsonb;
            n := 0;
            FOREACH mod_name IN ARRAY string_to_array(typed, ',')
            LOOP
                mod_name := regexp_replace(mod_name, '^\s+|\s+$', '', 'g');
                CONTINUE WHEN mod_name = '';
                n := n + 1;
                items := items || jsonb_build_object('mod-' || n, jsonb_build_object('name', mod_name));
                layouts := layouts || jsonb_build_object('mod-' || n, jsonb_build_object('colIndex', 0, 'rowIndex', n - 1));
            END LOOP;
            armour := armour || jsonb_build_object('mods', jsonb_build_object('items', items, 'layouts', layouts));
        END IF;

        result := jsonb_set(result, ARRAY['gear', 'list', 'items', item_key, 'armour'], armour - 'upgrades');
    END LOOP;

    RETURN result;
END;
$$;

DO $$
DECLARE
    rec RECORD;
    new_content jsonb;
    updated_rows integer := 0;
BEGIN
    FOR rec IN
        SELECT id, content
        FROM character_sheets
    LOOP
        new_content := armour_mods(rec.content);

        IF new_content IS DISTINCT FROM rec.content THEN
            UPDATE character_sheets
            SET content = new_content
            WHERE id = rec.id;

            updated_rows := updated_rows + 1;

            INSERT INTO temp_migrated_sheets(id)
            VALUES (rec.id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    RAISE NOTICE 'Moved armour upgrades to mods in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

DROP FUNCTION armour_mods(jsonb);

COMMIT;
