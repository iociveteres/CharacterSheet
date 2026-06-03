BEGIN;

ALTER TABLE room_messages ADD COLUMN character_name TEXT;

COMMIT;