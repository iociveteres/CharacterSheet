BEGIN;

CREATE TEMP TABLE temp_reverted_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Back to a number. For a single sheet's content, a base of the threshold
-- that is a whole number becomes fatigueMax; an empty one T.b+W.b as the
-- characteristics are typed, which the up migration left empty; any other 0.
-- The modifiers are lost. Then the stat goes.
CREATE OR REPLACE FUNCTION fatigue_threshold_number(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    block jsonb := content -> 'fatigue';
    val text;
    rules int := 0;
    char_key text;
BEGIN
    -- The up migration leaves no threshold where the rules count.
    IF jsonb_typeof(block) IS DISTINCT FROM 'object' OR block ? 'fatigueMax' THEN
        RETURN content;
    END IF;

    FOREACH char_key IN ARRAY ARRAY['T', 'W']
    LOOP
        rules := rules
            + LEAST(COALESCE(substring(content #>> ARRAY['characteristics', char_key, 'value'] FROM '^\s*([+-]?\d+)')::int, 0), 100) / 10
            + COALESCE(substring(content #>> ARRAY['characteristics', char_key, 'unnatural'] FROM '^\s*([+-]?\d+)')::int, 0);
    END LOOP;

    val := btrim(COALESCE(block #>> ARRAY['threshold', 'base'], ''));
    block := block || jsonb_build_object('fatigueMax',
        CASE WHEN val = '' THEN rules WHEN val ~ '^-?\d+$' THEN val::int ELSE 0 END);
    RETURN jsonb_set(content, ARRAY['fatigue'], block - 'threshold');
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
        new_content := fatigue_threshold_number(rec.content);

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

    RAISE NOTICE 'Moved the fatigue threshold back to a number in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_reverted_sheets);

DROP FUNCTION fatigue_threshold_number(jsonb);

COMMIT;
