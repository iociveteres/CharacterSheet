BEGIN;

ALTER TABLE
    character_sheets DROP COLUMN IF EXISTS sheet_kind;

DROP TYPE IF EXISTS sheet_kind;

COMMIT;
