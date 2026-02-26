BEGIN;

CREATE TEMP TABLE temp_unwrapped_sheets (id int PRIMARY KEY) ON COMMIT DROP;

-- Unwraps content -> section from { "list": { "items":{}, "layouts":{} } }
--                              to { "items":{}, "layouts":{} }
-- Idempotent: skips rows where there is no "list" key.
CREATE OR REPLACE FUNCTION unwrap_section_from_list(section text)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    cnt integer := 0;
BEGIN
    FOR rec IN
        SELECT id
        FROM character_sheets
        WHERE (content -> section) ? 'list'
    LOOP
        UPDATE character_sheets
        SET content = jsonb_set(
            content,
            ARRAY[section],
            (content -> section) -> 'list',
            false
        )
        WHERE id = rec.id;

        cnt := cnt + 1;
        INSERT INTO temp_unwrapped_sheets(id) VALUES (rec.id) ON CONFLICT DO NOTHING;
    END LOOP;

    RETURN cnt;
END;
$$;

SELECT unwrap_section_from_list('customSkills')     AS custom_skills_unwrapped;
SELECT unwrap_section_from_list('notes')            AS notes_unwrapped;
SELECT unwrap_section_from_list('resourceTrackers') AS resource_trackers_unwrapped;
SELECT unwrap_section_from_list('powerShields')     AS power_shields_unwrapped;
SELECT unwrap_section_from_list('rangedAttacks')    AS ranged_attacks_unwrapped;
SELECT unwrap_section_from_list('meleeAttacks')     AS melee_attacks_unwrapped;
SELECT unwrap_section_from_list('traits')           AS traits_unwrapped;
SELECT unwrap_section_from_list('talents')          AS talents_unwrapped;
SELECT unwrap_section_from_list('gear')             AS gear_unwrapped;
SELECT unwrap_section_from_list('cybernetics')      AS cybernetics_unwrapped;
SELECT unwrap_section_from_list('mutations')        AS mutations_unwrapped;
SELECT unwrap_section_from_list('mentalDisorders')  AS mental_disorders_unwrapped;
SELECT unwrap_section_from_list('diseases')         AS diseases_unwrapped;

UPDATE character_sheets
SET version    = version - 1,
    updated_at = now()
WHERE id IN (SELECT id FROM temp_unwrapped_sheets);

SELECT COUNT(*) AS total_unwrapped FROM temp_unwrapped_sheets;

DROP FUNCTION unwrap_section_from_list(text);

COMMIT;