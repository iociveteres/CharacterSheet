BEGIN;

-- The name of the character, kept by Postgres on every write of the content:
-- lists, searches and sorts read it without unpacking the content.
ALTER TABLE character_sheets
    ADD COLUMN character_name TEXT NOT NULL
    GENERATED ALWAYS AS (COALESCE(content->'characterInfo'->>'characterName', '')) STORED;

COMMIT;
