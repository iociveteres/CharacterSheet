BEGIN;

ALTER TABLE initiative_groups ADD COLUMN position INT;

UPDATE initiative_groups g SET position = ip.position
FROM initiative_positions ip
WHERE ip.group_id = g.id AND ip.encounter_id = g.encounter_id;

-- Every character of the party goes into each encounter of its room in a group
-- of its own, at the place its group had there or else last.
DO $$
DECLARE
    c RECORD;
    new_group INT;
BEGIN
    FOR c IN
        SELECT p.sheet_id, p.display_name, e.id AS encounter_id, ip.position
        FROM encounter_participants p
        JOIN encounters e ON e.room_id = p.room_id
        LEFT JOIN initiative_positions ip ON ip.group_id = p.group_id AND ip.encounter_id = e.id
        WHERE p.room_id IS NOT NULL
        ORDER BY e.id, ip.position NULLS LAST, p.group_id, p.id
    LOOP
        INSERT INTO initiative_groups (encounter_id, position)
        SELECT c.encounter_id, COALESCE(c.position, (SELECT COALESCE(MAX(position), -1) + 1 FROM initiative_groups WHERE encounter_id = c.encounter_id))
        RETURNING id INTO new_group;
        INSERT INTO encounter_participants (encounter_id, group_id, sheet_id, display_name, side)
        VALUES (c.encounter_id, new_group, c.sheet_id, c.display_name, 'party');
    END LOOP;
END $$;

-- The turn of a group of the party is lost: current_group_id goes NULL.
DELETE FROM encounter_participants WHERE room_id IS NOT NULL;
DELETE FROM initiative_groups WHERE room_id IS NOT NULL;

-- A group of an encounter without a position comes last, as it did.
UPDATE initiative_groups g SET position = last.position + unplaced.rank
FROM (
    SELECT encounter_id, COALESCE(MAX(position), -1) AS position FROM initiative_groups GROUP BY encounter_id
) last,
(
    SELECT id, row_number() OVER (PARTITION BY encounter_id ORDER BY id) AS rank FROM initiative_groups WHERE position IS NULL
) unplaced
WHERE g.position IS NULL AND unplaced.id = g.id AND last.encounter_id = g.encounter_id;

ALTER TABLE encounter_participants
    DROP CONSTRAINT encounter_participants_room_id_sheet_id_key,
    DROP CONSTRAINT encounter_participants_one_home,
    DROP COLUMN side,
    DROP COLUMN room_id,
    ALTER COLUMN encounter_id SET NOT NULL;

DROP INDEX idx_initiative_groups_room_id;

ALTER TABLE initiative_groups
    DROP CONSTRAINT initiative_groups_one_home,
    DROP COLUMN room_id,
    ALTER COLUMN position SET NOT NULL,
    ALTER COLUMN encounter_id SET NOT NULL;

DROP TABLE initiative_positions;

ALTER TABLE encounters DROP COLUMN description;

DROP TYPE encounter_side;

COMMIT;
