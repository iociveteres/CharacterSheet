BEGIN;

CREATE TEMP TABLE temp_reverted_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Back to numbers. For a single sheet's content, a base of cognitionMax or
-- energyMax that is a whole number becomes maxCognition or maxEnergy, any
-- other 0; restoreCognition is 0, as it was never counted. The modifiers are
-- lost. Then the stats go.
CREATE OR REPLACE FUNCTION techno_arcana_resource_numbers(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    block jsonb := content -> 'technoArcana';
    pair text[];
    val text;
BEGIN
    IF jsonb_typeof(block) IS DISTINCT FROM 'object'
        OR NOT (block ?| ARRAY['cognitionMax', 'cognitionRestore', 'energyMax', 'energyRestore']) THEN
        RETURN content;
    END IF;

    FOREACH pair SLICE 1 IN ARRAY ARRAY[['cognitionMax', 'maxCognition'], ['energyMax', 'maxEnergy']]
    LOOP
        val := btrim(COALESCE(block #>> ARRAY[pair[1], 'base'], ''));
        block := block || jsonb_build_object(pair[2], CASE WHEN val ~ '^-?\d+$' THEN val::int ELSE 0 END);
    END LOOP;

    block := block || jsonb_build_object('restoreCognition', 0);
    block := block - 'cognitionMax' - 'cognitionRestore' - 'energyMax' - 'energyRestore';
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
        new_content := techno_arcana_resource_numbers(rec.content);

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

    RAISE NOTICE 'Moved cognition and energy back to numbers in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_reverted_sheets);

DROP FUNCTION techno_arcana_resource_numbers(jsonb);

COMMIT;
