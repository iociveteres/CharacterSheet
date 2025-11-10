BEGIN;

ALTER TABLE room_messages 
DROP COLUMN command_result;

END;