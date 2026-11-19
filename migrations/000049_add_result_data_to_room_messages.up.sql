-- The outcome of a versus roll as data, which each viewer renders in their own
-- language; null for other messages and for those posted before it.
ALTER TABLE room_messages ADD COLUMN result_data JSONB NULL;
