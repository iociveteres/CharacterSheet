BEGIN;

CREATE TYPE sheet_kind AS ENUM (
    'black_crusade',
    'pathfinder_crusade'
);

ALTER TABLE
    character_sheets
ADD
    COLUMN sheet_kind sheet_kind NOT NULL DEFAULT 'black_crusade';

COMMIT;
