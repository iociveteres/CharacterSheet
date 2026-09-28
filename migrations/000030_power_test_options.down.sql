BEGIN;

CREATE TEMP TABLE temp_reverted_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Back to the fixed selects. For a single sheet's content, the roll of each
-- power of psykana and techno arcana gets as its baseSelect the value of the
-- test option it names, in place of the option's id; a value the fixed select
-- lacks, or a deleted option, gives its first option. Then the testOptions
-- grids go.
CREATE OR REPLACE FUNCTION remove_power_test_options(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    result jsonb := content;
    block text;
    known text[];
    tab_key text;
    power_key text;
    roll_path text[];
    roll jsonb;
    opt jsonb;
    val text;
BEGIN
    FOREACH block IN ARRAY ARRAY['psykana', 'technoArcana']
    LOOP
        IF block = 'psykana' THEN
            known := ARRAY['W', 'P', 'psyniscience', 'logic', 'Cor'];
        ELSE
            known := ARRAY['tech-use', 'medicae', 'awareness (I)', 'athletics', 'logic'];
        END IF;

        IF jsonb_typeof(result #> ARRAY[block, 'tabs', 'items']) = 'object' THEN
            FOR tab_key IN SELECT jsonb_object_keys(result #> ARRAY[block, 'tabs', 'items'])
            LOOP
                IF jsonb_typeof(result #> ARRAY[block, 'tabs', 'items', tab_key, 'powers', 'items']) IS DISTINCT FROM 'object' THEN
                    CONTINUE;
                END IF;
                FOR power_key IN SELECT jsonb_object_keys(result #> ARRAY[block, 'tabs', 'items', tab_key, 'powers', 'items'])
                LOOP
                    roll_path := ARRAY[block, 'tabs', 'items', tab_key, 'powers', 'items', power_key, 'roll'];
                    roll := result #> roll_path;
                    IF jsonb_typeof(roll) IS DISTINCT FROM 'object' THEN
                        CONTINUE;
                    END IF;
                    opt := result #> ARRAY[block, 'testOptions', 'items', COALESCE(roll ->> 'testOption', '')];
                    val := NULL;
                    IF jsonb_typeof(opt) = 'object' THEN
                        val := COALESCE(opt ->> 'base', '');
                        IF COALESCE(opt ->> 'characteristic', '') <> '' THEN
                            val := val || ' (' || (opt ->> 'characteristic') || ')';
                        END IF;
                    END IF;
                    IF val IS NULL OR NOT val = ANY(known) THEN
                        val := known[1];
                    END IF;
                    result := jsonb_set(result, roll_path,
                        (roll - 'testOption') || jsonb_build_object('baseSelect', val), false);
                END LOOP;
            END LOOP;
        END IF;

        result := result #- ARRAY[block, 'testOptions'];
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
        new_content := remove_power_test_options(rec.content);

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

    RAISE NOTICE 'Removed power test options from % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_reverted_sheets);

DROP FUNCTION remove_power_test_options(jsonb);

COMMIT;
