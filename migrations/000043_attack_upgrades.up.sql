BEGIN;

CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Ranged and melee attacks have no upgrades text: the mods of a weapon are in
-- its gear item. For a single sheet's content (WithAttackUpgradesInDescription
-- in character_sheets_defaults.go does the same on import), a typed text goes
-- to the end of the attack's description as a line "Upgrades: …"; empty or a
-- lone dash, which the book writes for none, it just goes.
CREATE OR REPLACE FUNCTION attack_upgrades_in_description(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    result jsonb := content;
    block text;
    item_key text;
    attack jsonb;
    typed text;
    described text;
BEGIN
    FOREACH block IN ARRAY ARRAY['rangedAttacks', 'meleeAttacks']
    LOOP
        CONTINUE WHEN jsonb_typeof(content #> ARRAY[block, 'list', 'items']) IS DISTINCT FROM 'object';

        FOR item_key IN SELECT jsonb_object_keys(content #> ARRAY[block, 'list', 'items'])
        LOOP
            attack := content #> ARRAY[block, 'list', 'items', item_key];
            IF jsonb_typeof(attack) IS DISTINCT FROM 'object' OR NOT attack ? 'upgrades' THEN
                CONTINUE;
            END IF;

            typed := CASE WHEN jsonb_typeof(attack -> 'upgrades') = 'string'
                THEN regexp_replace(attack ->> 'upgrades', '^\s+|\s+$', '', 'g') ELSE '' END;
            described := CASE WHEN jsonb_typeof(attack -> 'description') = 'string' THEN attack ->> 'description' ELSE '' END;
            attack := attack - 'upgrades';
            IF typed NOT IN ('', '-', '–', '—') THEN
                attack := attack || jsonb_build_object('description',
                    CASE WHEN regexp_replace(described, '^\s+|\s+$', '', 'g') = '' THEN 'Upgrades: ' || typed
                         ELSE described || E'\n\nUpgrades: ' || typed END);
            END IF;

            result := jsonb_set(result, ARRAY[block, 'list', 'items', item_key], attack);
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
        new_content := attack_upgrades_in_description(rec.content);

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

    RAISE NOTICE 'Moved attack upgrades to descriptions in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

DROP FUNCTION attack_upgrades_in_description(jsonb);

COMMIT;
