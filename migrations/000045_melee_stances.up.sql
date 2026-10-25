BEGIN;

CREATE TEMP TABLE temp_migrated_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- The stance is one for the sheet, meleeAttacks.stance, instead of the
-- Defensive checkbox of a shield and the Stance column of each melee roll.
-- For a single sheet's content (WithStances in character_sheets_defaults.go
-- does the same on import), an equipped shield marked defensive makes the
-- stance Defensive; then every shield loses defensive and every melee roll
-- its stance. Values typed into the Stance column are lost: the stance takes
-- its numbers from the rules.
CREATE OR REPLACE FUNCTION melee_stances(content jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    block jsonb := content -> 'meleeAttacks';
    attack_id text;
    attack jsonb;
    changed boolean := false;
    defensive boolean := false;
BEGIN
    IF jsonb_typeof(block #> '{list,items}') IS DISTINCT FROM 'object' THEN
        RETURN content;
    END IF;

    FOR attack_id, attack IN SELECT key, value FROM jsonb_each(block #> '{list,items}')
    LOOP
        CONTINUE WHEN jsonb_typeof(attack) IS DISTINCT FROM 'object';
        IF jsonb_typeof(attack -> 'shield') = 'object' AND attack -> 'shield' ? 'defensive' THEN
            IF attack #> '{shield,defensive}' = 'true'::jsonb AND attack #> '{shield,equipped}' = 'true'::jsonb THEN
                defensive := true;
            END IF;
            attack := jsonb_set(attack, '{shield}', (attack -> 'shield') - 'defensive');
            changed := true;
        END IF;
        IF jsonb_typeof(attack -> 'roll') = 'object' AND attack -> 'roll' ? 'stance' THEN
            attack := jsonb_set(attack, '{roll}', (attack -> 'roll') - 'stance');
            changed := true;
        END IF;
        block := jsonb_set(block, ARRAY['list', 'items', attack_id], attack);
    END LOOP;

    IF NOT changed THEN
        RETURN content;
    END IF;
    IF defensive THEN
        block := block || jsonb_build_object('stance', 'defensive');
    END IF;
    RETURN jsonb_set(content, '{meleeAttacks}', block);
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
        new_content := melee_stances(rec.content);

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

    RAISE NOTICE 'Moved the stance to the melee attacks block in % character sheets', updated_rows;
END;
$$;

UPDATE character_sheets
SET version = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_migrated_sheets);

DROP FUNCTION melee_stances(jsonb);

COMMIT;
