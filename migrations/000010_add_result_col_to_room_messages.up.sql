BEGIN;

ALTER TABLE room_messages 
ADD COLUMN command_result TEXT;

END;