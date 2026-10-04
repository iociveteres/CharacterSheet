BEGIN;

-- A bestiary collection of a user: creatures, sheets the gamemaster builds
-- NPCs from (_prd/gm_mode/data-model.md). Private for now: visibility and the
-- link come with the shared collections.
CREATE TABLE bestiary_collections (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bestiary_collections_owner_id ON bestiary_collections(owner_id);

-- The third home of a sheet: a collection (a creature).
ALTER TABLE character_sheets
    ADD COLUMN collection_id INT REFERENCES bestiary_collections(id) ON DELETE CASCADE,
    DROP CONSTRAINT one_home,
    ADD CONSTRAINT one_home CHECK (num_nonnulls(room_id, encounter_id, collection_id) = 1);

CREATE INDEX idx_character_sheets_collection_id ON character_sheets(collection_id);

-- A creature is seen and edited by the owner of its collection only. Sheets
-- of rooms and encounters keep the rules of 000032.
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
    )
    OR EXISTS (
        SELECT 1
        FROM character_sheets cs
        JOIN bestiary_collections c ON c.id = cs.collection_id
        WHERE cs.id = p_sheet_id
        AND c.owner_id = p_user_id
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
    )
    OR EXISTS (
        SELECT 1
        FROM character_sheets cs
        JOIN bestiary_collections c ON c.id = cs.collection_id
        WHERE cs.id = p_sheet_id
        AND c.owner_id = p_user_id
    );
$$ LANGUAGE sql STABLE;

COMMIT;
