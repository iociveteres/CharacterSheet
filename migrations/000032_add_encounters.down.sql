BEGIN;

-- NPCs live only as long as their encounter: they go with it.
DELETE FROM character_sheets WHERE encounter_id IS NOT NULL;

-- The permission functions of 000019
CREATE OR REPLACE FUNCTION can_edit_character_sheet(p_user_id INT, p_sheet_id INT) 
RETURNS BOOLEAN AS $$
SELECT
    EXISTS (
        SELECT 1
        FROM character_sheets cs
        LEFT JOIN character_sheet_folders f ON f.id = cs.folder_id
        LEFT JOIN room_members rm ON rm.room_id = cs.room_id AND rm.user_id = p_user_id
        WHERE cs.id = p_sheet_id
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
    );
$$ LANGUAGE sql STABLE;

ALTER TABLE rooms DROP COLUMN shown_encounter_id;

DROP TABLE encounter_participants;

ALTER TABLE character_sheets
    DROP CONSTRAINT one_home,
    DROP COLUMN source_label,
    DROP COLUMN source_sheet_id,
    DROP COLUMN encounter_id,
    ALTER COLUMN room_id SET NOT NULL;

ALTER TABLE encounters DROP CONSTRAINT encounters_current_group_id_fkey;
DROP TABLE initiative_groups;
DROP TABLE encounters;

COMMIT;
