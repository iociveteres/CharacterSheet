BEGIN;

-- temp table to collect migrated row ids; will be dropped at transaction end
CREATE TEMP TABLE temp_migrated_character_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- converts numeric or legacy numeric -> {"armour-value": <int>}
CREATE
OR REPLACE FUNCTION migrate_armour_part(part_name text, legacy_key text) RETURNS integer LANGUAGE plpgsql AS $$ DECLARE rec RECORD;

updated_rows integer := 0;

BEGIN FOR rec IN
UPDATE
    character_sheets
SET
    content = jsonb_set(
        content,
        ARRAY ['armour', part_name],
        jsonb_build_object(
            'armour-value',
            to_jsonb(
                COALESCE(
                    NULLIF(
                        jsonb_extract_path_text(content, 'armour', part_name),
                        ''
                    ),
                    NULLIF(
                        jsonb_extract_path_text(content, 'armour', legacy_key),
                        ''
                    ),
                    '0'
                ) :: int
            )
        ),
        true
    )
WHERE
    content ? 'armour'
    AND (
        jsonb_typeof(jsonb_extract_path(content, 'armour', part_name)) = 'number'
        OR (
            content -> 'armour' ? legacy_key
            AND jsonb_typeof(
                jsonb_extract_path(content, 'armour', legacy_key)
            ) = 'number'
        )
    ) RETURNING id LOOP -- log migrated id (ON CONFLICT DO NOTHING keeps id unique across multiple part runs)
INSERT INTO
    temp_migrated_character_sheets(id)
VALUES
    (rec.id) ON CONFLICT DO NOTHING;

updated_rows := updated_rows + 1;

END LOOP;

-- Remove legacy key under 'armour' if present
UPDATE
    character_sheets
SET
    content = jsonb_set(
        content,
        ARRAY ['armour'],
        (content -> 'armour') - legacy_key,
        false
    )
WHERE
    content ? 'armour'
    AND content -> 'armour' ? legacy_key;

RETURN updated_rows;

END;

$$;

-- Run migration for all six parts
SELECT
    migrate_armour_part('head', 'armour-head') AS head_migrated;

SELECT
    migrate_armour_part('left-arm', 'armour-left-arm') AS left_arm_migrated;

SELECT
    migrate_armour_part('right-arm', 'armour-right-arm') AS right_arm_migrated;

SELECT
    migrate_armour_part('left-leg', 'armour-left-leg') AS left_leg_migrated;

SELECT
    migrate_armour_part('right-leg', 'armour-right-leg') AS right_leg_migrated;

SELECT
    migrate_armour_part('body', 'armour-body') AS body_migrated;

-- Bump version + updated_at for rows that were migrated
UPDATE
    character_sheets
SET
    version = version + 1,
    updated_at = now()
WHERE
    id IN (
        SELECT
            id
        FROM
            temp_migrated_character_sheets
    );

SELECT
    COUNT(*) AS total_migrated
FROM
    temp_migrated_character_sheets;

-- Cleanup
DROP FUNCTION migrate_armour_part(text, text);

COMMIT;