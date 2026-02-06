BEGIN;

-- Temp table to track migrated sheets
CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Function to add default roll data to psychic powers
CREATE OR REPLACE FUNCTION add_psychic_power_rolls()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    tab_key text;
    power_key text;
    updated_rows integer := 0;
    default_roll jsonb;
BEGIN
    default_roll := jsonb_build_object(
        'base-select', 'W',
        'modifier', 0,
        'effective-pr', 0,
        'kick-pr', 0,
        'extra1', jsonb_build_object('enabled', false, 'name', '', 'value', 0),
        'extra2', jsonb_build_object('enabled', false, 'name', '', 'value', 0)
    );

    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> ARRAY['psykana', 'tabs', 'items'] IS NOT NULL
    LOOP
        FOR tab_key IN
            SELECT jsonb_object_keys(rec.content #> ARRAY['psykana', 'tabs', 'items'])
        LOOP
            -- skip if powers/items doesn't exist in this tab
            IF (rec.content #> ARRAY['psykana','tabs','items', tab_key, 'powers','items']) IS NULL THEN
                CONTINUE;
            END IF;

            FOR power_key IN
                SELECT jsonb_object_keys(rec.content #> ARRAY['psykana','tabs','items', tab_key, 'powers', 'items'])
            LOOP
                IF rec.content #> ARRAY['psykana','tabs','items', tab_key, 'powers', 'items', power_key, 'roll'] IS NULL THEN
                    UPDATE character_sheets
                    SET content = jsonb_set(
                        content,
                        ARRAY['psykana','tabs','items', tab_key, 'powers', 'items', power_key, 'roll'],
                        default_roll,
                        true
                    )
                    WHERE id = rec.id;

                    updated_rows := updated_rows + 1;

                    INSERT INTO temp_migrated_sheets(id)
                    VALUES (rec.id)
                    ON CONFLICT DO NOTHING;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    RETURN updated_rows;
END;
$$;

-- Function to add default roll data to techno powers
CREATE OR REPLACE FUNCTION add_tech_power_rolls()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    tab_key text;
    power_key text;
    updated_rows integer := 0;
    default_roll jsonb;
BEGIN
    default_roll := jsonb_build_object(
        'base-select', 'Tech-Use',
        'modifier', 0,
        'extra1', jsonb_build_object('enabled', false, 'name', '', 'value', 0),
        'extra2', jsonb_build_object('enabled', false, 'name', '', 'value', 0)
    );

    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> ARRAY['techno-arcana', 'tabs', 'items'] IS NOT NULL
    LOOP
        FOR tab_key IN
            SELECT jsonb_object_keys(rec.content #> ARRAY['techno-arcana', 'tabs', 'items'])
        LOOP
            -- skip if powers/items doesn't exist in this tab
            IF (rec.content #> ARRAY['techno-arcana','tabs','items', tab_key, 'powers','items']) IS NULL THEN
                CONTINUE;
            END IF;

            FOR power_key IN
                SELECT jsonb_object_keys(rec.content #> ARRAY['techno-arcana','tabs','items', tab_key, 'powers', 'items'])
            LOOP
                IF rec.content #> ARRAY['techno-arcana','tabs','items', tab_key, 'powers', 'items', power_key, 'roll'] IS NULL THEN
                    UPDATE character_sheets
                    SET content = jsonb_set(
                        content,
                        ARRAY['techno-arcana','tabs','items', tab_key, 'powers', 'items', power_key, 'roll'],
                        default_roll,
                        true
                    )
                    WHERE id = rec.id;

                    updated_rows := updated_rows + 1;

                    INSERT INTO temp_migrated_sheets(id)
                    VALUES (rec.id)
                    ON CONFLICT DO NOTHING;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    RETURN updated_rows;
END;
$$;

-- Run migrations
SELECT add_psychic_power_rolls() AS psychic_powers_migrated;
SELECT add_tech_power_rolls() AS techno_powers_migrated;

-- Bump version for migrated sheets
UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

-- Summary
SELECT COUNT(*) AS total_migrated
FROM temp_migrated_sheets;

-- Cleanup
DROP FUNCTION add_psychic_power_rolls();
DROP FUNCTION add_tech_power_rolls();

COMMIT;
