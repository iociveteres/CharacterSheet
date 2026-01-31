BEGIN;

-- Temp table to track rolled-back sheets
CREATE TEMP TABLE temp_rolled_back_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Function to remove roll data from ranged attacks
CREATE OR REPLACE FUNCTION remove_ranged_attack_rolls()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    attack_key text;
    updated_rows integer := 0;
BEGIN
    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> ARRAY['ranged-attack', 'items'] IS NOT NULL
    LOOP
        -- Iterate through each ranged attack item
        FOR attack_key IN
            SELECT jsonb_object_keys(rec.content #> ARRAY['ranged-attack', 'items'])
        LOOP
            -- Remove roll field if it exists
            IF rec.content #> ARRAY['ranged-attack', 'items', attack_key, 'roll'] IS NOT NULL THEN
                UPDATE character_sheets
                SET content = content #- ARRAY['ranged-attack', 'items', attack_key, 'roll']
                WHERE id = rec.id;
                
                updated_rows := updated_rows + 1;
                
                INSERT INTO temp_rolled_back_sheets(id)
                VALUES (rec.id)
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END LOOP;
    
    RETURN updated_rows;
END;
$$;

-- Function to remove roll data from melee attacks
CREATE OR REPLACE FUNCTION remove_melee_attack_rolls()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    attack_key text;
    updated_rows integer := 0;
BEGIN
    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> ARRAY['melee-attack', 'items'] IS NOT NULL
    LOOP
        -- Iterate through each melee attack item
        FOR attack_key IN
            SELECT jsonb_object_keys(rec.content #> ARRAY['melee-attack', 'items'])
        LOOP
            -- Remove roll field if it exists
            IF rec.content #> ARRAY['melee-attack', 'items', attack_key, 'roll'] IS NOT NULL THEN
                UPDATE character_sheets
                SET content = content #- ARRAY['melee-attack', 'items', attack_key, 'roll']
                WHERE id = rec.id;
                
                updated_rows := updated_rows + 1;
                
                INSERT INTO temp_rolled_back_sheets(id)
                VALUES (rec.id)
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END LOOP;
    
    RETURN updated_rows;
END;
$$;

-- Run rollbacks
SELECT remove_ranged_attack_rolls() AS ranged_attacks_rolled_back;
SELECT remove_melee_attack_rolls() AS melee_attacks_rolled_back;

-- Decrement version for rolled-back sheets
UPDATE character_sheets
SET version = version - 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_rolled_back_sheets);

-- Summary
SELECT COUNT(*) AS total_rolled_back
FROM temp_rolled_back_sheets;

-- Cleanup
DROP FUNCTION remove_ranged_attack_rolls();
DROP FUNCTION remove_melee_attack_rolls();

COMMIT;