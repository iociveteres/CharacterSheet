BEGIN;

-- Temp table to track rolled-back sheets
CREATE TEMP TABLE temp_rolled_back_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Function to remove roll data from psychic powers
CREATE OR REPLACE FUNCTION remove_psychic_power_rolls()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    tab_key text;
    power_key text;
    updated_rows integer := 0;
BEGIN
    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> ARRAY['psykana', 'tabs', 'items'] IS NOT NULL
    LOOP
        FOR tab_key IN
            SELECT jsonb_object_keys(rec.content #> ARRAY['psykana', 'tabs', 'items'])
        LOOP
            IF (rec.content #> ARRAY['psykana','tabs','items', tab_key, 'powers','items']) IS NULL THEN
                CONTINUE;
            END IF;

            FOR power_key IN
                SELECT jsonb_object_keys(rec.content #> ARRAY['psykana','tabs','items', tab_key, 'powers', 'items'])
            LOOP
                IF rec.content #> ARRAY['psykana','tabs','items', tab_key, 'powers', 'items', power_key, 'roll'] IS NOT NULL THEN
                    UPDATE character_sheets
                    SET content = content #- ARRAY['psykana','tabs','items', tab_key, 'powers', 'items', power_key, 'roll']
                    WHERE id = rec.id;

                    updated_rows := updated_rows + 1;

                    INSERT INTO temp_rolled_back_sheets(id)
                    VALUES (rec.id)
                    ON CONFLICT DO NOTHING;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    RETURN updated_rows;
END;
$$;

-- Function to remove roll data from techno powers
CREATE OR REPLACE FUNCTION remove_tech_power_rolls()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    tab_key text;
    power_key text;
    updated_rows integer := 0;
BEGIN
    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> ARRAY['techno-arcana', 'tabs', 'items'] IS NOT NULL
    LOOP
        FOR tab_key IN
            SELECT jsonb_object_keys(rec.content #> ARRAY['techno-arcana', 'tabs', 'items'])
        LOOP
            IF (rec.content #> ARRAY['techno-arcana','tabs','items', tab_key, 'powers','items']) IS NULL THEN
                CONTINUE;
            END IF;

            FOR power_key IN
                SELECT jsonb_object_keys(rec.content #> ARRAY['techno-arcana','tabs','items', tab_key, 'powers', 'items'])
            LOOP
                IF rec.content #> ARRAY['techno-arcana','tabs','items', tab_key, 'powers', 'items', power_key, 'roll'] IS NOT NULL THEN
                    UPDATE character_sheets
                    SET content = content #- ARRAY['techno-arcana','tabs','items', tab_key, 'powers', 'items', power_key, 'roll']
                    WHERE id = rec.id;

                    updated_rows := updated_rows + 1;

                    INSERT INTO temp_rolled_back_sheets(id)
                    VALUES (rec.id)
                    ON CONFLICT DO NOTHING;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    RETURN updated_rows;
END;
$$;

-- Run rollbacks
SELECT remove_psychic_power_rolls() AS psychic_powers_rolled_back;
SELECT remove_tech_power_rolls() AS techno_powers_rolled_back;

-- Decrement version for rolled-back sheets
UPDATE character_sheets
SET version = version - 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_rolled_back_sheets);

-- Summary
SELECT COUNT(*) AS total_rolled_back
FROM temp_rolled_back_sheets;

-- Cleanup
DROP FUNCTION remove_psychic_power_rolls();
DROP FUNCTION remove_tech_power_rolls();

COMMIT;
