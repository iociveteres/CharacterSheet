BEGIN;

-- Creatures live only in their collections: they go with them.
DELETE FROM character_sheets WHERE collection_id IS NOT NULL;

-- The permission functions of 000032
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

ALTER TABLE character_sheets
    DROP CONSTRAINT one_home,
    DROP COLUMN tags,
    DROP COLUMN collection_id,
    ADD CONSTRAINT one_home CHECK (num_nonnulls(room_id, encounter_id) = 1);

DROP TABLE bestiary_collections;

COMMIT;
