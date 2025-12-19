BEGIN;

UPDATE character_sheets 
SET sheet_visibility = 'everyone_can_view' 
WHERE sheet_visibility = 'everyone_can_see';

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
                    AND cs.sheet_visibility != 'hide_from_players'
                )
            )
    );
$$ LANGUAGE sql STABLE;


ALTER TABLE character_sheets 
ALTER COLUMN sheet_visibility TYPE VARCHAR(50);

DROP TYPE sheet_visibility;

CREATE TYPE sheet_visibility AS ENUM (
    'everyone_can_edit',
    'everyone_can_view',
    'hide_from_players'
);

ALTER TABLE character_sheets 
ALTER COLUMN sheet_visibility TYPE sheet_visibility 
USING sheet_visibility::sheet_visibility;

COMMIT;