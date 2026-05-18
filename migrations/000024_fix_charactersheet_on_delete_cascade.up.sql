BEGIN;

ALTER TABLE character_sheets
  DROP CONSTRAINT character_sheets_room_id_fkey,
  ADD CONSTRAINT character_sheets_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

COMMIT;