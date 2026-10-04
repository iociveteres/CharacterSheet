BEGIN;

-- A saved scene of a room: its participants in initiative groups, the round
-- and whose turn it is (_prd/gm_mode/data-model.md). Only the gamemaster of
-- the room sees and changes it.
CREATE TABLE encounters (
    id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id          INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    round            INT NOT NULL DEFAULT 1,
    current_group_id INT,
    -- What the players see: written by the gamemaster's client, which alone
    -- can count the initiative of every participant.
    initiative_view  JSONB,
    version          INT NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_encounters_room_id ON encounters(room_id);

-- A slot of the turn order. Every participant is in exactly one group; a
-- group holds participants of one column only: sheets of the room or NPCs.
CREATE TABLE initiative_groups (
    id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    encounter_id INT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    position     INT NOT NULL,
    name         TEXT
);

CREATE INDEX idx_initiative_groups_encounter_id ON initiative_groups(encounter_id);

-- The model passes the turn on when the current group goes; this only keeps
-- the reference valid.
ALTER TABLE encounters
    ADD CONSTRAINT encounters_current_group_id_fkey
    FOREIGN KEY (current_group_id) REFERENCES initiative_groups(id) ON DELETE SET NULL;

-- A sheet has exactly one home: a room (a character) or an encounter (an NPC).
ALTER TABLE character_sheets
    ALTER COLUMN room_id DROP NOT NULL,
    ADD COLUMN encounter_id    INT REFERENCES encounters(id) ON DELETE CASCADE,
    -- Where the sheet was copied from; the label stays when the source goes.
    ADD COLUMN source_sheet_id INT REFERENCES character_sheets(id) ON DELETE SET NULL,
    ADD COLUMN source_label    TEXT,
    ADD CONSTRAINT one_home CHECK (num_nonnulls(room_id, encounter_id) = 1);

CREATE INDEX idx_character_sheets_encounter_id ON character_sheets(encounter_id);

CREATE TABLE encounter_participants (
    id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    encounter_id INT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    group_id     INT NOT NULL REFERENCES initiative_groups(id),
    sheet_id     INT NOT NULL REFERENCES character_sheets(id) ON DELETE CASCADE,
    -- The name the players see instead of the sheet's
    display_name TEXT,
    UNIQUE (encounter_id, sheet_id)
);

CREATE INDEX idx_encounter_participants_group_id ON encounter_participants(group_id);
CREATE INDEX idx_encounter_participants_sheet_id ON encounter_participants(sheet_id);

-- The encounter whose initiative_view every member of the room sees.
ALTER TABLE rooms
    ADD COLUMN shown_encounter_id INT REFERENCES encounters(id) ON DELETE SET NULL;

-- A sheet of an encounter is seen and edited by the gamemaster of its room
-- only: not by the moderator, and not by its owner once they are not the
-- gamemaster. A sheet of a room keeps the rules of 000019.
CREATE OR REPLACE FUNCTION can_edit_character_sheet(p_user_id INT, p_sheet_id INT)
RETURNS BOOLEAN AS $$
SELECT
    EXISTS (
        SELECT 1
        FROM character_sheets cs
        LEFT JOIN character_sheet_folders f ON f.id = cs.folder_id
        LEFT JOIN room_members rm ON rm.room_id = cs.room_id AND rm.user_id = p_user_id
        WHERE cs.id = p_sheet_id
        AND cs.room_id IS NOT NULL
        AND (
            -- Owner can always edit
            cs.owner_id = p_user_id
            -- GM/moderator can always edit
            OR rm.role IN ('gamemaster', 'moderator')
            -- Regular members: check folder visibility first, then sheet visibility
            OR (
                rm.user_id IS NOT NULL
                AND (
                    -- If in folder, folder visibility overrides
                    (cs.folder_id IS NOT NULL AND f.folder_visibility = 'everyone_can_edit')
                    -- If not in folder, use sheet visibility
                    OR (cs.folder_id IS NULL AND cs.sheet_visibility = 'everyone_can_edit')
                )
            )
        )
    )
    OR EXISTS (
        SELECT 1
        FROM character_sheets cs
        JOIN encounters e ON e.id = cs.encounter_id
        JOIN room_members rm ON rm.room_id = e.room_id AND rm.user_id = p_user_id
        WHERE cs.id = p_sheet_id
        AND rm.role = 'gamemaster'
    );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION can_view_character_sheet(p_user_id INT, p_sheet_id INT)
RETURNS BOOLEAN AS $$
SELECT
    EXISTS (
        SELECT 1
        FROM character_sheets cs
        LEFT JOIN character_sheet_folders f ON f.id = cs.folder_id
        LEFT JOIN room_members rm ON rm.room_id = cs.room_id AND rm.user_id = p_user_id
        WHERE cs.id = p_sheet_id
        AND cs.room_id IS NOT NULL
        AND (
            -- Owner can always view
            cs.owner_id = p_user_id
            -- Gamemaster can always view
            OR rm.role = 'gamemaster'
            -- Moderator can view
            OR rm.role = 'moderator'
            -- Regular members: check folder visibility first, then sheet visibility
            OR (
                rm.user_id IS NOT NULL
                AND (
                    -- If in folder, folder visibility overrides
                    (cs.folder_id IS NOT NULL AND f.folder_visibility IN ('everyone_can_edit', 'everyone_can_view'))
                    -- If not in folder, use sheet visibility
                    OR (cs.folder_id IS NULL AND cs.sheet_visibility IN ('everyone_can_edit', 'everyone_can_view'))
                )
            )
        )
    )
    OR EXISTS (
        SELECT 1
        FROM character_sheets cs
        JOIN encounters e ON e.id = cs.encounter_id
        JOIN room_members rm ON rm.room_id = e.room_id AND rm.user_id = p_user_id
        WHERE cs.id = p_sheet_id
        AND rm.role = 'gamemaster'
    );
$$ LANGUAGE sql STABLE;

COMMIT;
