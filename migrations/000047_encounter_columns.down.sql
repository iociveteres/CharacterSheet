BEGIN;

ALTER TABLE encounters
    DROP COLUMN party_by_initiative,
    DROP COLUMN enemies_by_initiative;

DROP TABLE column_positions;

COMMIT;
