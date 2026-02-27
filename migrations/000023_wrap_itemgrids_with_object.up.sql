BEGIN;

CREATE TEMP TABLE temp_wrapped_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Wraps content -> section from { "items":{}, "layouts":{} }
--                             to { "list": { "items":{}, "layouts":{} } }
-- Idempotent: skips rows already containing a "list" key.
CREATE OR REPLACE FUNCTION wrap_section_in_list(section text)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    cnt integer := 0;
BEGIN
    FOR rec IN
        SELECT id
        FROM character_sheets
        WHERE content ? section
          AND NOT (content -> section) ? 'list'
    LOOP
        UPDATE character_sheets
        SET content = jsonb_set(
            content,
            ARRAY[section],
            jsonb_build_object('list', content -> section),
            false
        )
        WHERE id = rec.id;

        cnt := cnt + 1;
        INSERT INTO temp_wrapped_sheets(id) VALUES (rec.id) ON CONFLICT DO NOTHING;
    END LOOP;

    RETURN cnt;
END;
$$;

SELECT wrap_section_in_list('customSkills')     AS custom_skills_wrapped;
SELECT wrap_section_in_list('notes')            AS notes_wrapped;
SELECT wrap_section_in_list('resourceTrackers') AS resource_trackers_wrapped;
SELECT wrap_section_in_list('powerShields')     AS power_shields_wrapped;
SELECT wrap_section_in_list('rangedAttacks')    AS ranged_attacks_wrapped;
SELECT wrap_section_in_list('meleeAttacks')     AS melee_attacks_wrapped;
SELECT wrap_section_in_list('traits')           AS traits_wrapped;
SELECT wrap_section_in_list('talents')          AS talents_wrapped;
SELECT wrap_section_in_list('gear')             AS gear_wrapped;
SELECT wrap_section_in_list('cybernetics')      AS cybernetics_wrapped;
SELECT wrap_section_in_list('mutations')        AS mutations_wrapped;
SELECT wrap_section_in_list('mentalDisorders')  AS mental_disorders_wrapped;
SELECT wrap_section_in_list('diseases')         AS diseases_wrapped;

UPDATE character_sheets
SET version    = version + 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_wrapped_sheets);

SELECT COUNT(*) AS total_wrapped FROM temp_wrapped_sheets;

DROP FUNCTION wrap_section_in_list(text);

COMMIT;