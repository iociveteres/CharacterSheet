BEGIN;

DROP INDEX idx_character_sheets_source_sheet_id;

ALTER TABLE character_sheets DROP COLUMN author_label, DROP COLUMN author_id;

COMMIT;
