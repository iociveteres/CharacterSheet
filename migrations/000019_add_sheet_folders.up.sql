BEGIN;

-- Create character_sheet_folders table
CREATE TABLE character_sheet_folders (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    folder_visibility sheet_visibility NOT NULL DEFAULT 'everyone_can_view',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_folder_per_user_room UNIQUE(owner_id, room_id, name)
);

-- Add indexes for performance
CREATE INDEX idx_folders_owner_room ON character_sheet_folders(owner_id, room_id);
CREATE INDEX idx_folders_sort_order ON character_sheet_folders(owner_id, room_id, sort_order);

-- Add folder_id column to character_sheets
ALTER TABLE character_sheets 
ADD COLUMN folder_id INT REFERENCES character_sheet_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_character_sheets_folder_id ON character_sheets(folder_id);

-- Update permission functions to consider folder visibility
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

COMMIT;