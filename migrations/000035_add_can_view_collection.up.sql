BEGIN;

-- Whether a user can view a collection: theirs or public. The one rule of the
-- creatures' access and of the bestiary model (internal/models/bestiary.go).
CREATE FUNCTION can_view_collection(p_user_id INT, p_collection_id INT)
RETURNS BOOLEAN AS $$
SELECT EXISTS (
    SELECT 1
    FROM bestiary_collections c
    WHERE c.id = p_collection_id
    AND (c.owner_id = p_user_id OR c.visibility = 'public')
);
$$ LANGUAGE sql STABLE;

-- The body of 000034; a creature is seen by whoever can view its collection.
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
    )
    OR EXISTS (
        SELECT 1
        FROM character_sheets cs
        WHERE cs.id = p_sheet_id
        AND can_view_collection(p_user_id, cs.collection_id)
    );
$$ LANGUAGE sql STABLE;

COMMIT;
