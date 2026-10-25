BEGIN;

CREATE TEMP TABLE temp_reverted_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Back to a Defensive checkbox per shield and a Stance column per melee
-- roll. For a single sheet's content, an equipped shield is defensive while
-- the stance is Defensive, every other one is not; every melee roll gets the
-- column with its default numbers (0, +10, -10), Standard selected. The
-- stance and the setting that hides the stances go.
CREATE OR REPLACE FUNCTION melee_stances_back(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    block jsonb := content -> 'meleeAttacks';
    attack_id text;
    attack jsonb;
    defensive boolean;
BEGIN
    IF jsonb_typeof(block) IS DISTINCT FROM 'object' THEN
        RETURN content;
    END IF;
    defensive := COALESCE(block -> 'stance' = '"defensive"'::jsonb, false);

    IF jsonb_typeof(block #> '{list,items}') = 'object' THEN
        FOR attack_id, attack IN SELECT key, value FROM jsonb_each(block #> '{list,items}')
        LOOP
            CONTINUE WHEN jsonb_typeof(attack) IS DISTINCT FROM 'object';
            IF jsonb_typeof(attack -> 'shield') = 'object' THEN
                attack := jsonb_set(attack, '{shield,defensive}',
                    to_jsonb(defensive AND COALESCE(attack #> '{shield,equipped}' = 'true'::jsonb, false)));
            END IF;
            IF jsonb_typeof(attack -> 'roll') = 'object' THEN
                attack := jsonb_set(attack, '{roll,stance}',
                    '{"selected": "standard", "standard": 0, "aggressive": 10, "defensive": -10}'::jsonb);
            END IF;
            block := jsonb_set(block, ARRAY['list', 'items', attack_id], attack);
        END LOOP;
    END IF;

    content := jsonb_set(content, '{meleeAttacks}', block - 'stance');
    IF jsonb_typeof(content -> 'settings') = 'object' THEN
        content := jsonb_set(content, '{settings}', (content -> 'settings') - 'meleeAttacks');
    END IF;
    RETURN content;
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
        new_content := melee_stances_back(rec.content);

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

    RAISE NOTICE 'Moved the stance back to the shields and melee rolls in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_reverted_sheets);

DROP FUNCTION melee_stances_back(jsonb);

COMMIT;
