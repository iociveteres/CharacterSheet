BEGIN;

-- Temp table to track migrated sheets
CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Function to add default roll data to ranged attacks
CREATE OR REPLACE FUNCTION add_ranged_attack_rolls()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    attack_key text;
    updated_rows integer := 0;
    default_roll jsonb;
BEGIN
    -- Define default ranged attack roll structure
    default_roll := jsonb_build_object(
        'aim', jsonb_build_object(
            'selected', 'no',
            'no', 0,
            'half', 10,
            'full', 20
        ),
        'target', jsonb_build_object(
            'selected', 'no',
            'no', 0,
            'torso', -10,
            'leg', -10,
            'arm', -20,
            'head', -20,
            'joint', -30,
            'eyes', -40
        ),
        'range', jsonb_build_object(
            'selected', 'combat',
            'melee', 30,
            'point-blank', 30,
            'short', 10,
            'combat', 0,
            'long', -10,
            'extreme', -30
        ),
        'rof', jsonb_build_object(
            'selected', 'single',
            'single', 0,
            'short', 10,
            'long', 20,
            'suppression', -20
        ),
        'extra1', jsonb_build_object(
            'enabled', false,
            'name', '',
            'value', 0
        ),
        'extra2', jsonb_build_object(
            'enabled', false,
            'name', '',
            'value', 0
        )
    );

    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> ARRAY['ranged-attack', 'items'] IS NOT NULL
    LOOP
        -- Iterate through each ranged attack item
        FOR attack_key IN
            SELECT jsonb_object_keys(rec.content #> ARRAY['ranged-attack', 'items'])
        LOOP
            -- Only add roll if it doesn't already exist
            IF rec.content #> ARRAY['ranged-attack', 'items', attack_key, 'roll'] IS NULL THEN
                UPDATE character_sheets
                SET content = jsonb_set(
                    content,
                    ARRAY['ranged-attack', 'items', attack_key, 'roll'],
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
    
    RETURN updated_rows;
END;
$$;

-- Function to add default roll data to melee attacks
CREATE OR REPLACE FUNCTION add_melee_attack_rolls()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    attack_key text;
    updated_rows integer := 0;
    default_roll jsonb;
BEGIN
    -- Define default melee attack roll structure
    default_roll := jsonb_build_object(
        'aim', jsonb_build_object(
            'selected', 'no',
            'no', 0,
            'half', 10,
            'full', 20
        ),
        'target', jsonb_build_object(
            'selected', 'no',
            'no', 0,
            'torso', -10,
            'leg', -10,
            'arm', -20,
            'head', -20,
            'joint', -30,
            'eyes', -40
        ),
        'base', jsonb_build_object(
            'selected', 'standard',
            'standard', 0,
            'charge', 10,
            'full', -10,
            'careful', 10,
            'mounted', 20
        ),
        'stance', jsonb_build_object(
            'selected', 'standard',
            'standard', 0,
            'aggressive', 10,
            'defensive', -10
        ),
        'rof', jsonb_build_object(
            'selected', 'single',
            'single', 0,
            'quick', -10,
            'lightning', -20
        ),
        'extra1', jsonb_build_object(
            'enabled', false,
            'name', '',
            'value', 0
        ),
        'extra2', jsonb_build_object(
            'enabled', false,
            'name', '',
            'value', 0
        )
    );

    FOR rec IN
        SELECT id, content
        FROM character_sheets
        WHERE content #> ARRAY['melee-attack', 'items'] IS NOT NULL
    LOOP
        -- Iterate through each melee attack item
        FOR attack_key IN
            SELECT jsonb_object_keys(rec.content #> ARRAY['melee-attack', 'items'])
        LOOP
            -- Only add roll if it doesn't already exist
            IF rec.content #> ARRAY['melee-attack', 'items', attack_key, 'roll'] IS NULL THEN
                UPDATE character_sheets
                SET content = jsonb_set(
                    content,
                    ARRAY['melee-attack', 'items', attack_key, 'roll'],
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
    
    RETURN updated_rows;
END;
$$;

-- Run migrations
SELECT add_ranged_attack_rolls() AS ranged_attacks_migrated;
SELECT add_melee_attack_rolls() AS melee_attacks_migrated;

-- Bump version for migrated sheets
UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

-- Summary
SELECT COUNT(*) AS total_migrated
FROM temp_migrated_sheets;

-- Cleanup
DROP FUNCTION add_ranged_attack_rolls();
DROP FUNCTION add_melee_attack_rolls();

COMMIT;