BEGIN;

CREATE TEMP TABLE temp_reverted_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Back to one movement with a bonus and multipliers, from the first mode by
-- its row; the other modes are lost. For a single sheet's content, the bonus
-- is the signed number that ends the first mode's SPD ("A.b+Size+2" gives 2),
-- 0 without one; its multipliers are rounded to whole numbers, 0 or none give
-- 2, 3 and 6.
CREATE OR REPLACE FUNCTION movement_from_modes(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    block jsonb := content -> 'movement';
    first_key text;
    mode jsonb := '{}'::jsonb;
    spd text;
    result jsonb;
    mult record;
BEGIN
    IF jsonb_typeof(block) IS DISTINCT FROM 'object' OR NOT block ? 'modes' THEN
        RETURN content;
    END IF;

    IF jsonb_typeof(block #> '{modes,items}') = 'object' THEN
        SELECT key INTO first_key
        FROM jsonb_object_keys(block #> '{modes,items}') AS key
        ORDER BY CASE WHEN jsonb_typeof(block #> ARRAY['modes', 'layouts', key, 'rowIndex']) = 'number'
                      THEN (block #>> ARRAY['modes', 'layouts', key, 'rowIndex'])::numeric END NULLS LAST, key
        LIMIT 1;
        IF jsonb_typeof(block #> ARRAY['modes', 'items', first_key]) = 'object' THEN
            mode := block #> ARRAY['modes', 'items', first_key];
        END IF;
    END IF;

    spd := regexp_replace(CASE WHEN jsonb_typeof(mode -> 'spd') = 'string' THEN mode ->> 'spd' ELSE '' END, '\s+', '', 'g');
    result := jsonb_build_object('bonus', COALESCE(replace(substring(spd FROM '[+-]\d+$'), '+', '')::int, 0));
    FOR mult IN SELECT * FROM (VALUES ('fullMult', 2), ('chargeMult', 3), ('runMult', 6)) AS m(field, def)
    LOOP
        result := result || jsonb_build_object(mult.field,
            CASE WHEN jsonb_typeof(mode -> mult.field) IS DISTINCT FROM 'number' THEN mult.def
                 WHEN round((mode ->> mult.field)::numeric) = 0 THEN mult.def
                 ELSE round((mode ->> mult.field)::numeric)::int END);
    END LOOP;

    RETURN jsonb_set(content, ARRAY['movement'], (block - 'modes') || result);
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
        new_content := movement_from_modes(rec.content);

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

    RAISE NOTICE 'Moved the movement back from modes in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_reverted_sheets);

DROP FUNCTION movement_from_modes(jsonb);

COMMIT;
