BEGIN;

-- Temp table to track updated sheets
CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Fixes naming for a single character sheet's content:
--  1) top-level experience.alignment: "neutral" -> "Undivided",
--     and any stray "Nurgle (Immortal)" -> "Nurgle (Undying)"
--  2) each experienceLog item's alliedTo/hostileTo: "Nurgle (Immortal)" -> "Nurgle (Undying)"
CREATE OR REPLACE FUNCTION fix_alignment_naming(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    result jsonb := content;
    alignment text;
    item_key text;
    item jsonb;
    allied text;
    hostile text;
    new_allied text;
    new_hostile text;
BEGIN
    -- 1) Top-level alignment
    alignment := result #>> '{experience,alignment}';
    IF alignment IS NOT NULL THEN
        alignment := replace(alignment, 'Nurgle (Immortal)', 'Nurgle (Undying)');
        IF alignment = 'neutral' THEN
            alignment := 'Undivided';
        END IF;
        result := jsonb_set(result, '{experience,alignment}', to_jsonb(alignment), false);
    END IF;

    -- 2) Per-item alliedTo/hostileTo
    FOR item_key IN
        SELECT jsonb_object_keys(COALESCE(result #> '{experience,experienceLog,items}', '{}'::jsonb))
    LOOP
        item := result #> ARRAY['experience','experienceLog','items', item_key];

        allied := item ->> 'alliedTo';
        hostile := item ->> 'hostileTo';

        new_allied := replace(COALESCE(allied, ''), 'Nurgle (Immortal)', 'Nurgle (Undying)');
        new_hostile := replace(COALESCE(hostile, ''), 'Nurgle (Immortal)', 'Nurgle (Undying)');

        IF allied IS DISTINCT FROM new_allied THEN
            result := jsonb_set(
                result,
                ARRAY['experience','experienceLog','items', item_key, 'alliedTo'],
                to_jsonb(new_allied),
                true
            );
        END IF;

        IF hostile IS DISTINCT FROM new_hostile THEN
            result := jsonb_set(
                result,
                ARRAY['experience','experienceLog','items', item_key, 'hostileTo'],
                to_jsonb(new_hostile),
                true
            );
        END IF;
    END LOOP;

    RETURN result;
END;
$$;

-- Apply to all sheets, tracking which actually changed
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
        new_content := fix_alignment_naming(rec.content);

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

    RAISE NOTICE 'Fixed alignment naming on % character sheets', updated_rows;
END;
$$;

-- Bump version + updated_at for changed sheets
UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

-- Summary
SELECT COUNT(*) AS total_migrated
FROM temp_migrated_sheets;

-- Cleanup
DROP FUNCTION fix_alignment_naming(jsonb);

COMMIT;