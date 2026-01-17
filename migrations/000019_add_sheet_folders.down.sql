BEGIN;

-- Restore original permission functions
CREATE OR REPLACE FUNCTION can_edit_character_sheet(p_user_id INT, p_sheet_id INT) 
RETURNS BOOLEAN AS $$
SELECT
    EXISTS (
        SELECT 1
        FROM character_sheets cs
        LEFT JOIN room_members rm ON rm.room_id = cs.room_id AND rm.user_id = p_user_id
        WHERE cs.id = p_sheet_id
        AND (
            cs.owner_id = p_user_id
            OR rm.role IN ('gamemaster', 'moderator')
            OR (
                rm.user_id IS NOT NULL
                AND cs.sheet_visibility = 'everyone_can_edit'
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
        LEFT JOIN room_members rm ON rm.room_id = cs.room_id AND rm.user_id = p_user_id
        WHERE cs.id = p_sheet_id
        AND (
            cs.owner_id = p_user_id 
            OR rm.role = 'gamemaster' 
            OR rm.role = 'moderator' 
            OR (
                rm.user_id IS NOT NULL
                AND cs.sheet_visibility IN ('everyone_can_edit', 'everyone_can_view')
            )
        )
    );
$$ LANGUAGE sql STABLE;

-- Drop indexes
DROP INDEX IF EXISTS idx_character_sheets_folder_id;
DROP INDEX IF EXISTS idx_folders_sort_order;
DROP INDEX IF EXISTS idx_folders_owner_room;

-- Remove folder_id column from character_sheets
ALTER TABLE character_sheets DROP COLUMN IF EXISTS folder_id;

-- Drop folders table
DROP TABLE IF EXISTS character_sheet_folders;

COMMIT;