BEGIN;

ALTER TYPE sheet_visibility ADD VALUE 'everyone_can_see' AFTER 'everyone_can_view';

CREATE OR REPLACE FUNCTION can_view_character_sheet(p_user_id INT, p_sheet_id INT) 
RETURNS BOOLEAN AS $$
SELECT
    EXISTS (
        SELECT
            1
        FROM
            character_sheets cs
            LEFT JOIN room_members rm ON rm.room_id = cs.room_id
            AND rm.user_id = p_user_id
        WHERE
            cs.id = p_sheet_id
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

COMMIT;