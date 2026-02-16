BEGIN;

-- Temp table to track migrated sheets
CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Function to map old field names to new field names
CREATE OR REPLACE FUNCTION map_field_name_to_camel(old_name text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN CASE old_name
        -- Root level
        WHEN 'character-info' THEN 'characterInfo'
        WHEN 'skills-left' THEN 'skillsLeft'
        WHEN 'skills-right' THEN 'skillsRight'
        WHEN 'custom-skills' THEN 'customSkills'
        WHEN 'infamy-points' THEN 'infamyPoints'
        WHEN 'resource-trackers' THEN 'resourceTrackers'
        WHEN 'power-shields' THEN 'powerShields'
        WHEN 'ranged-attack' THEN 'rangedAttacks'
        WHEN 'melee-attack' THEN 'meleeAttacks'
        WHEN 'carry-weight-and-encumbrance' THEN 'carryWeightAndEncumbrance'
        WHEN 'mental-disorders' THEN 'mentalDisorders'
        WHEN 'techno-arcana' THEN 'technoArcana'
        
        -- CharacterInfo
        WHEN 'character-name' THEN 'characterName'
        WHEN 'warband-name' THEN 'warbandName'
        
        -- Characteristic
        WHEN 'temp-value' THEN 'tempValue'
        WHEN 'temp-unnatural' THEN 'tempUnnatural'
        WHEN 'temp-enabled' THEN 'tempEnabled'

        -- Skill
        WHEN '+0' THEN 'plus0'
        WHEN '+10' THEN 'plus10'
        WHEN '+20' THEN 'plus20'
        WHEN '+30' THEN 'plus30'
        WHEN 'misc-bonus' THEN 'miscBonus'
        
        -- InfamyPoints
        WHEN 'infamy_max' THEN 'infamyMax'
        WHEN 'infamy_cur' THEN 'infamyCur'
        WHEN 'infamy_temp' THEN 'infamyTemp'
        
        -- Fatigue
        WHEN 'fatigue_max' THEN 'fatigueMax'
        WHEN 'fatigue_cur' THEN 'fatigueCur'
        
        -- Movement
        WHEN 'move_half' THEN 'moveHalf'
        WHEN 'move_full' THEN 'moveFull'
        WHEN 'move_charge' THEN 'moveCharge'
        WHEN 'move_run' THEN 'moveRun'
        
        -- Armour
        WHEN 'left-arm' THEN 'leftArm'
        WHEN 'right-arm' THEN 'rightArm'
        WHEN 'left-leg' THEN 'leftLeg'
        WHEN 'right-leg' THEN 'rightLeg'
        WHEN 'wounds_max' THEN 'woundsMax'
        WHEN 'wounds_cur' THEN 'woundsCur'
        WHEN 'toughness-base-absorption-value' THEN 'toughnessBaseAbsorptionValue'
        WHEN 'natural-armor-value' THEN 'naturalArmourValue'
        WHEN 'machine-value' THEN 'machineValue'
        WHEN 'daemonic-value' THEN 'daemonicValue'
        WHEN 'other-armour-value' THEN 'otherArmourValue'
        
        -- BodyPart
        WHEN 'armour-value' THEN 'armourValue'
        WHEN 'extra1-name' THEN 'extra1Name'
        WHEN 'extra1-value' THEN 'extra1Value'
        WHEN 'extra2-name' THEN 'extra2Name'
        WHEN 'extra2-value' THEN 'extra2Value'
        WHEN 'superarmour' THEN 'superArmour'
        
        -- Attack fields
        WHEN 'damage-type' THEN 'damageType'
        WHEN 'rof-single' THEN 'rofSingle'
        WHEN 'rof-short' THEN 'rofShort'
        WHEN 'rof-long' THEN 'rofLong'
        WHEN 'clip-cur' THEN 'clipCur'
        WHEN 'clip-max' THEN 'clipMax'
        
        -- Range
        WHEN 'point-blank' THEN 'pointBlank'
        
        -- Roll
        WHEN 'base-select' THEN 'baseSelect'
        
        -- CarryWeight
        WHEN 'carry-weight-base' THEN 'carryWeightBase'
        WHEN 'carry-weight' THEN 'carryWeight'
        WHEN 'lift-weight' THEN 'liftWeight'
        WHEN 'push-weight' THEN 'pushWeight'
        
        -- Experience
        WHEN 'experience-total' THEN 'experienceTotal'
        WHEN 'experience-spent' THEN 'experienceSpent'
        WHEN 'experience-remaining' THEN 'experienceRemaining'
        WHEN 'experience-log' THEN 'experienceLog'
        WHEN 'experience-cost' THEN 'experienceCost'
        
        -- Psykana (note: PR acronym stays uppercase)
        WHEN 'psykana-type' THEN 'psykanaType'
        WHEN 'max-push' THEN 'maxPush'
        WHEN 'base-pr' THEN 'basePR'
        WHEN 'sustained-powers' THEN 'sustainedPowers'
        WHEN 'effective-pr' THEN 'effectivePR'
        WHEN 'kick-pr' THEN 'kickPR'
        WHEN 'weapon-range' THEN 'weaponRange'
        
        -- TechnoArcana
        WHEN 'current-cognition' THEN 'currentCognition'
        WHEN 'max-cognition' THEN 'maxCognition'
        WHEN 'restore-cognition' THEN 'restoreCognition'
        WHEN 'current-energy' THEN 'currentEnergy'
        WHEN 'max-energy' THEN 'maxEnergy'
        
        -- Default: return original name
        ELSE old_name
    END;
END;
$$;

-- Recursive function to transform JSON keys
CREATE OR REPLACE FUNCTION transform_json_keys_to_camel(input_json jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    result jsonb;
    key text;
    value jsonb;
    new_key text;
BEGIN
    IF jsonb_typeof(input_json) = 'object' THEN
        result := '{}'::jsonb;
        
        FOR key, value IN SELECT * FROM jsonb_each(input_json)
        LOOP
            new_key := map_field_name_to_camel(key);
            
            IF jsonb_typeof(value) = 'object' OR jsonb_typeof(value) = 'array' THEN
                result := result || jsonb_build_object(new_key, transform_json_keys_to_camel(value));
            ELSE
                result := result || jsonb_build_object(new_key, value);
            END IF;
        END LOOP;
        
        RETURN result;
    ELSIF jsonb_typeof(input_json) = 'array' THEN
        result := '[]'::jsonb;
        
        FOR value IN SELECT * FROM jsonb_array_elements(input_json)
        LOOP
            IF jsonb_typeof(value) = 'object' OR jsonb_typeof(value) = 'array' THEN
                result := result || jsonb_build_array(transform_json_keys_to_camel(value));
            ELSE
                result := result || jsonb_build_array(value);
            END IF;
        END LOOP;
        
        RETURN result;
    ELSE
        RETURN input_json;
    END IF;
END;
$$;

-- Update all character sheets
DO $$
DECLARE
    rec RECORD;
    updated_rows integer := 0;
BEGIN
    FOR rec IN
        SELECT id, content
        FROM character_sheets
    LOOP
        UPDATE character_sheets
        SET content = transform_json_keys_to_camel(content)
        WHERE id = rec.id;
        
        updated_rows := updated_rows + 1;
        
        INSERT INTO temp_migrated_sheets(id) 
        VALUES (rec.id);
    END LOOP;
    
    RAISE NOTICE 'Updated % character sheets', updated_rows;
END;
$$;

-- Bump version for migrated sheets
UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

-- Summary
SELECT COUNT(*) AS total_migrated 
FROM temp_migrated_sheets;

-- Cleanup
DROP FUNCTION transform_json_keys_to_camel(jsonb);
DROP FUNCTION map_field_name_to_camel(text);

COMMIT;