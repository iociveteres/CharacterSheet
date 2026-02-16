BEGIN;

-- Temp table to track migrated sheets
CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Function to map new field names back to old field names
CREATE OR REPLACE FUNCTION map_field_name_to_kebab(new_name text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN CASE new_name
        -- Root level
        WHEN 'characterInfo' THEN 'character-info'
        WHEN 'skillsLeft' THEN 'skills-left'
        WHEN 'skillsRight' THEN 'skills-right'
        WHEN 'customSkills' THEN 'custom-skills'
        WHEN 'infamyPoints' THEN 'infamy-points'
        WHEN 'resourceTrackers' THEN 'resource-trackers'
        WHEN 'powerShields' THEN 'power-shields'
        WHEN 'rangedAttacks' THEN 'ranged-attack'
        WHEN 'meleeAttacks' THEN 'melee-attack'
        WHEN 'carryWeightAndEncumbrance' THEN 'carry-weight-and-encumbrance'
        WHEN 'mentalDisorders' THEN 'mental-disorders'
        WHEN 'technoArcana' THEN 'techno-arcana'
        
        -- CharacterInfo
        WHEN 'characterName' THEN 'character-name'
        WHEN 'warbandName' THEN 'warband-name'
        
        -- Skill
        WHEN 'plus0' THEN '+0'
        WHEN 'plus10' THEN '+10'
        WHEN 'plus20' THEN '+20'
        WHEN 'plus30' THEN '+30'
        WHEN 'miscBonus' THEN 'misc-bonus'
        
        -- InfamyPoints
        WHEN 'infamyMax' THEN 'infamy_max'
        WHEN 'infamyCur' THEN 'infamy_cur'
        WHEN 'infamyTemp' THEN 'infamy_temp'
        
        -- Fatigue
        WHEN 'fatigueMax' THEN 'fatigue_max'
        WHEN 'fatigueCur' THEN 'fatigue_cur'
        
        -- Movement
        WHEN 'moveHalf' THEN 'move_half'
        WHEN 'moveFull' THEN 'move_full'
        WHEN 'moveCharge' THEN 'move_charge'
        WHEN 'moveRun' THEN 'move_run'
        
        -- Armour
        WHEN 'leftArm' THEN 'left-arm'
        WHEN 'rightArm' THEN 'right-arm'
        WHEN 'leftLeg' THEN 'left-leg'
        WHEN 'rightLeg' THEN 'right-leg'
        WHEN 'woundsMax' THEN 'wounds_max'
        WHEN 'woundsCur' THEN 'wounds_cur'
        WHEN 'toughnessBaseAbsorptionValue' THEN 'toughness-base-absorption-value'
        WHEN 'naturalArmourValue' THEN 'natural-armor-value'
        WHEN 'machineValue' THEN 'machine-value'
        WHEN 'daemonicValue' THEN 'daemonic-value'
        WHEN 'otherArmourValue' THEN 'other-armour-value'
        
        -- BodyPart
        WHEN 'armourValue' THEN 'armour-value'
        WHEN 'extra1Name' THEN 'extra1-name'
        WHEN 'extra1Value' THEN 'extra1-value'
        WHEN 'extra2Name' THEN 'extra2-name'
        WHEN 'extra2Value' THEN 'extra2-value'
        WHEN 'superArmour' THEN 'superarmour'
        
        -- Attack fields
        WHEN 'damageType' THEN 'damage-type'
        WHEN 'rofSingle' THEN 'rof-single'
        WHEN 'rofShort' THEN 'rof-short'
        WHEN 'rofLong' THEN 'rof-long'
        WHEN 'clipCur' THEN 'clip-cur'
        WHEN 'clipMax' THEN 'clip-max'
        
        -- Range
        WHEN 'pointBlank' THEN 'point-blank'
        
        -- Roll
        WHEN 'baseSelect' THEN 'base-select'
        
        -- CarryWeight
        WHEN 'carryWeightBase' THEN 'carry-weight-base'
        WHEN 'carryWeight' THEN 'carry-weight'
        WHEN 'liftWeight' THEN 'lift-weight'
        WHEN 'pushWeight' THEN 'push-weight'
        
        -- Experience
        WHEN 'experienceTotal' THEN 'experience-total'
        WHEN 'experienceSpent' THEN 'experience-spent'
        WHEN 'experienceRemaining' THEN 'experience-remaining'
        WHEN 'experienceLog' THEN 'experience-log'
        WHEN 'experienceCost' THEN 'experience-cost'
        
        -- Psykana (note: PR acronym back to lowercase)
        WHEN 'psykanaType' THEN 'psykana-type'
        WHEN 'maxPush' THEN 'max-push'
        WHEN 'basePR' THEN 'base-pr'
        WHEN 'sustainedPowers' THEN 'sustained-powers'
        WHEN 'effectivePR' THEN 'effective-pr'
        WHEN 'kickPR' THEN 'kick-pr'
        WHEN 'weaponRange' THEN 'weapon-range'
        
        -- TechnoArcana
        WHEN 'currentCognition' THEN 'current-cognition'
        WHEN 'maxCognition' THEN 'max-cognition'
        WHEN 'restoreCognition' THEN 'restore-cognition'
        WHEN 'currentEnergy' THEN 'current-energy'
        WHEN 'maxEnergy' THEN 'max-energy'
        
        -- Characteristic
        WHEN 'tempValue' THEN 'temp-value'
        WHEN 'tempUnnatural' THEN 'temp-unnatural'
        WHEN 'tempEnabled' THEN 'temp-enabled'
        
        -- Default: return original name
        ELSE new_name
    END;
END;
$$;

-- Recursive function to transform JSON keys back
CREATE OR REPLACE FUNCTION transform_json_keys_to_kebab(input_json jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    result jsonb;
    key text;
    value jsonb;
    old_key text;
BEGIN
    IF jsonb_typeof(input_json) = 'object' THEN
        result := '{}'::jsonb;
        
        FOR key, value IN SELECT * FROM jsonb_each(input_json)
        LOOP
            old_key := map_field_name_to_kebab(key);
            
            IF jsonb_typeof(value) = 'object' OR jsonb_typeof(value) = 'array' THEN
                result := result || jsonb_build_object(old_key, transform_json_keys_to_kebab(value));
            ELSE
                result := result || jsonb_build_object(old_key, value);
            END IF;
        END LOOP;
        
        RETURN result;
    ELSIF jsonb_typeof(input_json) = 'array' THEN
        result := '[]'::jsonb;
        
        FOR value IN SELECT * FROM jsonb_array_elements(input_json)
        LOOP
            IF jsonb_typeof(value) = 'object' OR jsonb_typeof(value) = 'array' THEN
                result := result || jsonb_build_array(transform_json_keys_to_kebab(value));
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

-- Update all character sheets back
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
        SET content = transform_json_keys_to_kebab(content)
        WHERE id = rec.id;
        
        updated_rows := updated_rows + 1;
        
        INSERT INTO temp_migrated_sheets(id) 
        VALUES (rec.id);
    END LOOP;
    
    RAISE NOTICE 'Reverted % character sheets', updated_rows;
END;
$$;

-- Bump version for migrated sheets
UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

-- Summary
SELECT COUNT(*) AS total_reverted 
FROM temp_migrated_sheets;

-- Cleanup
DROP FUNCTION transform_json_keys_to_kebab(jsonb);
DROP FUNCTION map_field_name_to_kebab(text);

COMMIT;