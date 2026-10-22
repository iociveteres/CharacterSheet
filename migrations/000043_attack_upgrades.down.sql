BEGIN;

CREATE TEMP TABLE temp_reverted_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Back to an upgrades text. For a single sheet's content, the last line
-- "Upgrades: …" of the description of a ranged or melee attack, after a blank
-- line or alone, becomes its upgrades and leaves the description; an attack
-- without one gets empty upgrades.
CREATE OR REPLACE FUNCTION attack_upgrades_from_description(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    result jsonb := content;
    block text;
    item_key text;
    attack jsonb;
    described text;
    typed text := '';
BEGIN
    FOREACH block IN ARRAY ARRAY['rangedAttacks', 'meleeAttacks']
    LOOP
        CONTINUE WHEN jsonb_typeof(content #> ARRAY[block, 'list', 'items']) IS DISTINCT FROM 'object';

        FOR item_key IN SELECT jsonb_object_keys(content #> ARRAY[block, 'list', 'items'])
        LOOP
            attack := content #> ARRAY[block, 'list', 'items', item_key];
            IF jsonb_typeof(attack) IS DISTINCT FROM 'object' OR attack ? 'upgrades' THEN
                CONTINUE;
            END IF;

            typed := '';
            described := CASE WHEN jsonb_typeof(attack -> 'description') = 'string' THEN attack ->> 'description' ELSE '' END;
            IF described ~ '(^|\n\n)Upgrades: [^\n]*$' THEN
                typed := substring(described FROM 'Upgrades: ([^\n]*)$');
                attack := attack || jsonb_build_object('description', regexp_replace(described, '(^|\n\n)Upgrades: [^\n]*$', ''));
            END IF;

            result := jsonb_set(result, ARRAY[block, 'list', 'items', item_key], attack || jsonb_build_object('upgrades', typed));
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
        new_content := attack_upgrades_from_description(rec.content);

        IF new_content IS DISTINCT FROM rec.content THEN
            UPDATE character_sheets
            SET content = new_content
            WHERE id = rec.id;

            updated_rows := updated_rows + 1;

            INSERT INTO temp_reverted_sheets(id)
            VALUES (rec.id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    RAISE NOTICE 'Moved attack upgrades back from descriptions in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_reverted_sheets);

DROP FUNCTION attack_upgrades_from_description(jsonb);

COMMIT;
