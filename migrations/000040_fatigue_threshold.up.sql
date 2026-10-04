BEGIN;

CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- The fatigue threshold is a stat with a base expression and modifiers
-- (ResourceStat) instead of a number, T.b+W.b while its base is empty. For a
-- single sheet's content (WithFatigueThreshold in character_sheets_defaults.go
-- does the same on import), a typed fatigueMax other than 0 and T.b+W.b, as
-- the characteristics are typed, becomes the base of the threshold; those
-- leave it empty, to follow the rules. Then the number goes.
CREATE OR REPLACE FUNCTION fatigue_threshold(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    block jsonb := content -> 'fatigue';
    typed text;
    rules int := 0;
    char_key text;
BEGIN
    IF jsonb_typeof(block) IS DISTINCT FROM 'object' OR NOT block ? 'fatigueMax' THEN
        RETURN content;
    END IF;

    -- A bonus is the tens of the value, up to 100, and the unnatural; the
    -- leading whole number of each, as the sheet reads them.
    FOREACH char_key IN ARRAY ARRAY['T', 'W']
    LOOP
        rules := rules
            + LEAST(COALESCE(substring(content #>> ARRAY['characteristics', char_key, 'value'] FROM '^\s*([+-]?\d+)')::int, 0), 100) / 10
            + COALESCE(substring(content #>> ARRAY['characteristics', char_key, 'unnatural'] FROM '^\s*([+-]?\d+)')::int, 0);
    END LOOP;

    typed := btrim(COALESCE(block ->> 'fatigueMax', ''));
    IF typed ~ '^-?\d+$' AND typed::int NOT IN (0, rules) AND NOT block ? 'threshold' THEN
        block := block || jsonb_build_object('threshold', jsonb_build_object('base', typed::int::text));
    END IF;

    RETURN jsonb_set(content, ARRAY['fatigue'], block - 'fatigueMax');
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
        new_content := fatigue_threshold(rec.content);

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

    RAISE NOTICE 'Moved the fatigue threshold to a resource stat in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

DROP FUNCTION fatigue_threshold(jsonb);

COMMIT;
