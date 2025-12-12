BEGIN;

CREATE TYPE sheet_visibility AS ENUM (
    'everyone_can_edit',
    'everyone_can_view',
    'hide_from_players'
);

ALTER TABLE
    character_sheets
ADD
    COLUMN sheet_visibility sheet_visibility NOT NULL DEFAULT 'everyone_can_view';

CREATE
OR REPLACE FUNCTION can_edit_character_sheet(p_user_id INT, p_sheet_id INT) RETURNS BOOLEAN AS $$
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
                -- Owner can always edit
                cs.owner_id = p_user_id -- GM/moderator can always edit
                OR rm.role IN ('gamemaster', 'moderator') -- Regular members can edit if visibility allows it
                OR (
                    rm.user_id IS NOT NULL
                    AND cs.sheet_visibility = 'everyone_can_edit'
                )
            )
    );
$$ LANGUAGE sql STABLE;

CREATE
OR REPLACE FUNCTION can_view_character_sheet(p_user_id INT, p_sheet_id INT) RETURNS BOOLEAN AS $$
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
                -- Owner can always view
                cs.owner_id = p_user_id -- Gamemaster can always view
                OR rm.role = 'gamemaster' -- Moderator can view
                OR rm.role = 'moderator' -- Regular members can view if not hidden
                OR (
                    rm.user_id IS NOT NULL
                    AND cs.sheet_visibility != 'hide_from_players'
                )
            )
    );
$$ LANGUAGE sql STABLE;

COMMIT;