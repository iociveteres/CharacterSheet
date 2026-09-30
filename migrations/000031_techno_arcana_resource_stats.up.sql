BEGIN;

CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Techno arcana keeps its maximums and restoration of cognition and energy as
-- stats with a base expression and modifiers (ResourceStat) instead of
-- numbers. For a single sheet's content (WithResourceStats in
-- character_sheets_defaults.go does the same on import):
--  1) a typed maximum other than 0 becomes the base of cognitionMax or
--     energyMax; 0 leaves the base empty, the default of the rules
--  2) the numbers go; what a turn restored gives way to the default
CREATE OR REPLACE FUNCTION techno_arcana_resource_stats(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    block jsonb := content -> 'technoArcana';
    pair text[];
    val text;
BEGIN
    IF jsonb_typeof(block) IS DISTINCT FROM 'object'
        OR NOT (block ?| ARRAY['maxCognition', 'restoreCognition', 'maxEnergy']) THEN
        RETURN content;
    END IF;

    -- 1) The maximums
    FOREACH pair SLICE 1 IN ARRAY ARRAY[['maxCognition', 'cognitionMax'], ['maxEnergy', 'energyMax']]
    LOOP
        val := btrim(COALESCE(block ->> pair[1], ''));
        IF val NOT IN ('', '0') AND NOT block ? pair[2] THEN
            block := block || jsonb_build_object(pair[2], jsonb_build_object('base', val));
        END IF;
    END LOOP;

    -- 2) The numbers
    block := block - 'maxCognition' - 'restoreCognition' - 'maxEnergy';
    RETURN jsonb_set(content, ARRAY['technoArcana'], block);
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
        new_content := techno_arcana_resource_stats(rec.content);

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

    RAISE NOTICE 'Moved cognition and energy to resource stats in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

DROP FUNCTION techno_arcana_resource_stats(jsonb);

COMMIT;
