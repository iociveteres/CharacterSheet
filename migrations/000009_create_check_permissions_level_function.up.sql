BEGIN;

CREATE OR REPLACE FUNCTION has_sufficient_role(
    p_user_id INT,
    p_room_id INT,
    p_required_role room_role
) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM room_members
        WHERE room_id = p_room_id 
          AND user_id = p_user_id
          AND CASE role
                WHEN 'gamemaster' THEN 3
                WHEN 'moderator' THEN 2
                WHEN 'player' THEN 1
              END >= 
              CASE p_required_role
                WHEN 'gamemaster' THEN 3
                WHEN 'moderator' THEN 2
                WHEN 'player' THEN 1
              END
    );
$$ LANGUAGE sql STABLE;

END;