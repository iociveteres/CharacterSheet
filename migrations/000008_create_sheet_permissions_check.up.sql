BEGIN;

CREATE OR REPLACE FUNCTION can_edit_character_sheet(
    p_user_id INT,
    p_sheet_id INT
) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM character_sheets cs
        LEFT JOIN room_members rm 
            ON rm.room_id = cs.room_id 
            AND rm.user_id = p_user_id
        WHERE cs.id = p_sheet_id
          AND (
              cs.owner_id = p_user_id
              OR rm.role IN ('gamemaster', 'moderator')
          )
    );
$$ LANGUAGE sql STABLE;

CREATE INDEX idx_room_members_lookup ON room_members(room_id, user_id) INCLUDE (role);

END;