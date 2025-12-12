BEGIN;

DROP FUNCTION IF EXISTS can_view_character_sheet(INT, INT);

DROP FUNCTION IF EXISTS can_edit_character_sheet(INT, INT);

ALTER TABLE
    character_sheets DROP COLUMN IF EXISTS sheet_visibility;

DROP TYPE IF EXISTS sheet_visibility;

COMMIT;