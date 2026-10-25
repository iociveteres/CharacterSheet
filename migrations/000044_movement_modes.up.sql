BEGIN;

CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- The movement is a grid of modes, as Move or Flight, each with an SPD
-- expression and its own multipliers. For a single sheet's content
-- (WithMovementModes in character_sheets_defaults.go does the same on
-- import), a movement without modes gets one mode Move of SPD A.b+Size with
-- the typed bonus added, and the multipliers it had; 0 or none of them were
-- 2, 3 and 6. Then the old fields go.
CREATE OR REPLACE FUNCTION movement_modes(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    block jsonb := content -> 'movement';
    bonus int;
    spd text := 'A.b+Size';
    mode jsonb;
    mult record;
BEGIN
    IF jsonb_typeof(block) IS DISTINCT FROM 'object' OR block ? 'modes' THEN
        RETURN content;
    END IF;

    -- The leading whole number, as the sheet read it.
    bonus := COALESCE(substring(block ->> 'bonus' FROM '^\s*([+-]?\d+)')::int, 0);
    IF bonus > 0 THEN
        spd := spd || '+' || bonus;
    ELSIF bonus < 0 THEN
        spd := spd || bonus;
    END IF;

    mode := jsonb_build_object('name', 'Move', 'spd', spd, 'halfMult', 1);
    FOR mult IN SELECT * FROM (VALUES ('fullMult', 2), ('chargeMult', 3), ('runMult', 6)) AS m(field, def)
    LOOP
        mode := mode || jsonb_build_object(mult.field,
            -- Nested: AND would not keep the cast from a value that is no number.
            CASE WHEN jsonb_typeof(block -> mult.field) IS DISTINCT FROM 'number' THEN to_jsonb(mult.def)
                 WHEN (block ->> mult.field)::numeric = 0 THEN to_jsonb(mult.def)
                 ELSE block -> mult.field END);
    END LOOP;

    block := block - ARRAY['bonus', 'fullMult', 'chargeMult', 'runMult', 'moveHalf', 'moveFull', 'moveCharge', 'moveRun'];
    block := block || jsonb_build_object('modes', jsonb_build_object(
        'items', jsonb_build_object('mode-1', mode),
        'layouts', jsonb_build_object('mode-1', jsonb_build_object('colIndex', 0, 'rowIndex', 0))));
    RETURN jsonb_set(content, ARRAY['movement'], block);
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
        new_content := movement_modes(rec.content);

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

    RAISE NOTICE 'Moved the movement to modes in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

DROP FUNCTION movement_modes(jsonb);

COMMIT;
