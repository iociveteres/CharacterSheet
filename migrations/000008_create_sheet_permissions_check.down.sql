BEGIN;

DROP FUNCTION IF EXISTS check_sheet_permission(INT, INT);
DROP INDEX IF EXISTS idx_room_members_lookup;

END;