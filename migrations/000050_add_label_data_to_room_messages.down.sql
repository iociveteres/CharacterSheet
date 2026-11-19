-- Don't run this to roll back a release: rolls posted since migration 50 have
-- their label here only, cut from message_body, and would lose it. The older
-- code doesn't read the column and shows those rolls without a label; they get
-- it back with the next release.
ALTER TABLE room_messages DROP COLUMN label_data;
