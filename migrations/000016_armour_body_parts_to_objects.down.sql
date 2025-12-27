BEGIN;

-- Temp table to track migrated row ids
CREATE TEMP TABLE temp_rolled_back_character_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- converts {"armour-value": <int>} back to numeric
CREATE
OR REPLACE FUNCTION rollback_armour_part(part_name text, legacy_key text) RETURNS integer LANGUAGE plpgsql AS $$ DECLARE rec RECORD;

updated_rows integer := 0;

BEGIN -- Perform UPDATE: extract armour-value from object, set as legacy key
FOR rec IN
UPDATE
    character_sheets
SET
    content = jsonb_set(
        content,
        ARRAY ['armour', legacy_key],
        to_jsonb(
            COALESCE(
                (
                    content #>> ARRAY['armour', part_name, 'armour-value'])::int,
                    0
                )
            ),
            true
        )
        WHERE
            content ? 'armour'
            AND jsonb_typeof(jsonb_extract_path(content, 'armour', part_name)) = 'object'
            AND content #> ARRAY['armour', part_name] ? 'armour-value'
            RETURNING id LOOP -- Track migrated id
        INSERT INTO
            temp_rolled_back_character_sheets(id)
        VALUES
            (rec.id) ON CONFLICT DO NOTHING;

updated_rows := updated_rows + 1;

END LOOP;

-- Remove new key (the object) under 'armour' if present
UPDATE
    character_sheets
SET
    content = jsonb_set(
        content,
        ARRAY ['armour'],
        (content -> 'armour') - part_name,
        false
    )
WHERE
    content ? 'armour'
    AND content -> 'armour' ? part_name;

RETURN updated_rows;

END;

$$;

-- Run rollback for all six parts
SELECT
    rollback_armour_part('head', 'armour-head') AS head_rolled_back;

SELECT
    rollback_armour_part('left-arm', 'armour-left-arm') AS left_arm_rolled_back;

SELECT
    rollback_armour_part('right-arm', 'armour-right-arm') AS right_arm_rolled_back;

SELECT
    rollback_armour_part('left-leg', 'armour-left-leg') AS left_leg_rolled_back;

SELECT
    rollback_armour_part('right-leg', 'armour-right-leg') AS right_leg_rolled_back;

SELECT
    rollback_armour_part('body', 'armour-body') AS body_rolled_back;

-- Decrement version + updated_at for rows that were rolled back
UPDATE
    character_sheets
SET
    version = version - 1,
    updated_at = now()
WHERE
    id IN (
        SELECT
            id
        FROM
            temp_rolled_back_character_sheets
    );

-- Summary: how many distinct rows were rolled back
SELECT
    COUNT(*) AS total_rolled_back
FROM
    temp_rolled_back_character_sheets;

-- Cleanup
DROP FUNCTION rollback_armour_part(text, text);

COMMIT;