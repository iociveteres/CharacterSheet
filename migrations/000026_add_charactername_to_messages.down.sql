BEGIN;

ALTER TABLE room_messages DROP COLUMN character_name;

COMMIT;