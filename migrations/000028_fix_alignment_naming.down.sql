BEGIN;

-- Temp table to track reverted sheets
CREATE TEMP TABLE temp_reverted_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Reverses the naming fix:
--  1) top-level experience.alignment: "Undivided" -> "neutral",
--     "Nurgle (Undying)" -> "Nurgle (Immortal)"
--  2) each experienceLog item's alliedTo/hostileTo: "Nurgle (Undying)" -> "Nurgle (Immortal)"
CREATE OR REPLACE FUNCTION revert_alignment_naming(content jsonb)
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
        alignment := replace(alignment, 'Nurgle (Undying)', 'Nurgle (Immortal)');
        IF alignment = 'Undivided' THEN
            alignment := 'neutral';
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

        new_allied := replace(COALESCE(allied, ''), 'Nurgle (Undying)', 'Nurgle (Immortal)');
        new_hostile := replace(COALESCE(hostile, ''), 'Nurgle (Undying)', 'Nurgle (Immortal)');

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
        new_content := revert_alignment_naming(rec.content);

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

    RAISE NOTICE 'Reverted alignment naming on % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version - 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_reverted_sheets);

SELECT COUNT(*) AS total_reverted
FROM temp_reverted_sheets;

DROP FUNCTION revert_alignment_naming(jsonb);

COMMIT;