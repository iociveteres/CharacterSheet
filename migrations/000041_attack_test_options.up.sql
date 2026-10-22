BEGIN;

CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Attacks are tested on an option of their block's testOptions grid instead
-- of a fixed select, as powers are since 000030. For a single sheet's
-- content, ranged and melee attacks without testOptions
-- (WithAttackTestOptions in character_sheets_defaults.go does the same on
-- import):
--  1) get the options their fixed select offered and Medicae on BS or WS
--  2) the roll of each of their attacks gets the id of the option its
--     baseSelect named, in place of the baseSelect; the select showed an empty
--     or unknown value as its first option
CREATE OR REPLACE FUNCTION add_attack_test_options(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    result jsonb := content;
    block text;
    bases text[];
    chars text[];
    vals text[];
    items jsonb;
    layouts jsonb;
    i int;
    attack_key text;
    roll_path text[];
    roll jsonb;
BEGIN
    FOREACH block IN ARRAY ARRAY['rangedAttacks', 'meleeAttacks']
    LOOP
        IF block = 'rangedAttacks' THEN
            bases := ARRAY['BS', 'I', 'P', 'W', 'F', 'acrobatics', 'medicae'];
            chars := ARRAY['', '', '', '', '', '', 'BS'];
        ELSE
            bases := ARRAY['WS', 'I', 'P', 'W', 'F', 'medicae'];
            chars := ARRAY['', '', '', '', '', 'WS'];
        END IF;

        IF COALESCE(jsonb_typeof(result #> ARRAY[block, 'testOptions']), 'null') <> 'null' THEN
            CONTINUE;
        END IF;
        IF jsonb_typeof(result -> block) IS DISTINCT FROM 'object' THEN
            result := jsonb_set(result, ARRAY[block], '{}'::jsonb, true);
        END IF;

        -- 1) The options
        items := '{}'::jsonb;
        layouts := '{}'::jsonb;
        vals := ARRAY[]::text[];
        FOR i IN 1 .. array_length(bases, 1)
        LOOP
            items := items || jsonb_build_object('test-option-' || i,
                jsonb_build_object('base', bases[i], 'characteristic', chars[i]));
            layouts := layouts || jsonb_build_object('test-option-' || i,
                jsonb_build_object('colIndex', 0, 'rowIndex', i - 1));
            vals := vals || CASE WHEN chars[i] = '' THEN bases[i] ELSE bases[i] || ' (' || chars[i] || ')' END;
        END LOOP;
        result := jsonb_set(result, ARRAY[block, 'testOptions'],
            jsonb_build_object('items', items, 'layouts', layouts), true);

        -- 2) The attacks
        IF jsonb_typeof(result #> ARRAY[block, 'list', 'items']) IS DISTINCT FROM 'object' THEN
            CONTINUE;
        END IF;
        FOR attack_key IN SELECT jsonb_object_keys(result #> ARRAY[block, 'list', 'items'])
        LOOP
            roll_path := ARRAY[block, 'list', 'items', attack_key, 'roll'];
            roll := result #> roll_path;
            IF jsonb_typeof(roll) IS DISTINCT FROM 'object' THEN
                CONTINUE;
            END IF;
            i := COALESCE(array_position(vals, roll ->> 'baseSelect'), 1);
            result := jsonb_set(result, roll_path,
                (roll - 'baseSelect') || jsonb_build_object('testOption', 'test-option-' || i), false);
        END LOOP;
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
        new_content := add_attack_test_options(rec.content);

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

    RAISE NOTICE 'Added attack test options to % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

DROP FUNCTION add_attack_test_options(jsonb);

COMMIT;
