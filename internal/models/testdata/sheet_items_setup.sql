-- Minimal schema for the sheet item mutations (CreateItem, MoveItemBetweenGrids).
-- jsonb_ensure_path is loaded from its migration by the test itself.
CREATE TABLE character_sheets (
    id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    version    INT         NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permission stub: only user 1 may edit.
CREATE FUNCTION can_edit_character_sheet(p_user_id INT, p_sheet_id INT)
RETURNS BOOLEAN AS $$
    SELECT p_user_id = 1
$$ LANGUAGE sql;
