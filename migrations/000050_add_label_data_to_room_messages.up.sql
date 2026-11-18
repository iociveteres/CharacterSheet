-- The label of a roll from a sheet as codes, which each reader words in their
-- own language (ui/static/js/sheet/rollLabel.ts); the body keeps the command
-- without its ">>" lines. Null for other messages and for those posted before it.
ALTER TABLE room_messages ADD COLUMN label_data JSONB NULL;
