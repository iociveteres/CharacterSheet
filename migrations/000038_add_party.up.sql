BEGIN;

-- The characters of a room and their groups are its party, one for all its
-- encounters: changing the encounter changes only the NPCs. An NPC and its
-- group stay of their encounter.
CREATE TYPE encounter_side AS ENUM ('party', 'enemies');

-- The gamemaster's notes; the players never get them.
ALTER TABLE encounters ADD COLUMN description TEXT NOT NULL DEFAULT '';

-- The place of a group in the turn order of an encounter, of each encounter
-- of the room for a group of the party. A group without one comes last.
CREATE TABLE initiative_positions (
    encounter_id INT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    group_id     INT NOT NULL REFERENCES initiative_groups(id) ON DELETE CASCADE,
    position     INT NOT NULL,
    PRIMARY KEY (encounter_id, group_id)
);

CREATE INDEX idx_initiative_positions_group_id ON initiative_positions(group_id);

INSERT INTO initiative_positions (encounter_id, group_id, position)
SELECT encounter_id, id, position FROM initiative_groups;

ALTER TABLE initiative_groups
    ALTER COLUMN encounter_id DROP NOT NULL,
    ADD COLUMN room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
    DROP COLUMN position,
    ADD CONSTRAINT initiative_groups_one_home CHECK (num_nonnulls(room_id, encounter_id) = 1);

CREATE INDEX idx_initiative_groups_room_id ON initiative_groups(room_id);

ALTER TABLE encounter_participants
    ALTER COLUMN encounter_id DROP NOT NULL,
    ADD COLUMN room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
    -- The column the gamemaster put the participant in
    ADD COLUMN side encounter_side,
    ADD CONSTRAINT encounter_participants_one_home CHECK (num_nonnulls(room_id, encounter_id) = 1),
    ADD CONSTRAINT encounter_participants_room_id_sheet_id_key UNIQUE (room_id, sheet_id);

-- Every character of an encounter joins the party of its room once, in a group
-- of its own that keeps the place the character had in each encounter.
DO $$
DECLARE
    c RECORD;
    new_group INT;
BEGIN
    FOR c IN
        SELECT DISTINCT ON (p.sheet_id) p.sheet_id, e.room_id, p.display_name
        FROM encounter_participants p
        JOIN encounters e ON e.id = p.encounter_id
        JOIN character_sheets cs ON cs.id = p.sheet_id AND cs.encounter_id IS NULL
        -- The name shown instead of the sheet's, if any encounter had one
        ORDER BY p.sheet_id, p.display_name IS NULL, p.id
    LOOP
        INSERT INTO initiative_groups (room_id) VALUES (c.room_id) RETURNING id INTO new_group;
        INSERT INTO initiative_positions (encounter_id, group_id, position)
        SELECT ip.encounter_id, new_group, ip.position
        FROM encounter_participants p
        JOIN initiative_positions ip ON ip.group_id = p.group_id AND ip.encounter_id = p.encounter_id
        WHERE p.sheet_id = c.sheet_id AND p.encounter_id IS NOT NULL;
        INSERT INTO encounter_participants (room_id, group_id, sheet_id, display_name, side)
        VALUES (c.room_id, new_group, c.sheet_id, c.display_name, 'party');
    END LOOP;
END $$;

-- The turn of a group of characters is lost: current_group_id goes NULL.
DELETE FROM encounter_participants p
USING character_sheets cs
WHERE cs.id = p.sheet_id AND cs.encounter_id IS NULL AND p.encounter_id IS NOT NULL;

DELETE FROM initiative_groups g
WHERE g.encounter_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM encounter_participants p WHERE p.group_id = g.id);

UPDATE encounter_participants SET side = 'enemies' WHERE side IS NULL;

ALTER TABLE encounter_participants ALTER COLUMN side SET NOT NULL;

COMMIT;
