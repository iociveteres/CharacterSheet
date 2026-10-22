BEGIN;

CREATE TEMP TABLE temp_reverted_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Back to an upgrades text. For a single sheet's content, the names of the
-- mods of an armour, in the order of their rows, joined by commas, become its
-- upgrades. Their weights, descriptions and entries are lost. Then the grid goes.
CREATE OR REPLACE FUNCTION armour_upgrades(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    result jsonb := content;
    item_key text;
    armour jsonb;
    mods jsonb;
    typed text;
BEGIN
    IF jsonb_typeof(content #> '{gear,list,items}') IS DISTINCT FROM 'object' THEN
        RETURN content;
    END IF;

    FOR item_key IN SELECT jsonb_object_keys(content #> '{gear,list,items}')
    LOOP
        armour := content #> ARRAY['gear', 'list', 'items', item_key, 'armour'];
        IF jsonb_typeof(armour) IS DISTINCT FROM 'object' OR NOT armour ? 'mods' THEN
            CONTINUE;
        END IF;

        mods := CASE WHEN jsonb_typeof(armour #> '{mods,items}') = 'object' THEN armour #> '{mods,items}' ELSE '{}'::jsonb END;
        SELECT string_agg(btrim(m.value ->> 'name'), ', '
                   ORDER BY COALESCE(substring(armour #>> ARRAY['mods', 'layouts', m.key, 'rowIndex'] FROM '^-?\d+')::int, 0), m.key)
        INTO typed
        FROM jsonb_each(mods) m
        WHERE jsonb_typeof(m.value) = 'object' AND btrim(COALESCE(m.value ->> 'name', '')) <> '';

        result := jsonb_set(result, ARRAY['gear', 'list', 'items', item_key, 'armour'],
            (armour - 'mods') || jsonb_build_object('upgrades', COALESCE(typed, '')));
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
        new_content := armour_upgrades(rec.content);

        IF new_content IS DISTINCT FROM rec.content THEN
            UPDATE character_sheets
            SET content = new_content
            WHERE id = rec.id;

            updated_rows := updated_rows + 1;

            INSERT INTO temp_reverted_sheets(id)
            VALUES (rec.id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    RAISE NOTICE 'Moved armour mods back to upgrades in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_reverted_sheets);

DROP FUNCTION armour_upgrades(jsonb);

COMMIT;
