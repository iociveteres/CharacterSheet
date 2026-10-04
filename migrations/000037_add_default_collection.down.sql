BEGIN;

-- A default collection with creatures in it stays, as an ordinary one.
DELETE FROM bestiary_collections c
WHERE c.is_default
AND NOT EXISTS (SELECT 1 FROM character_sheets cs WHERE cs.collection_id = c.id);

DROP INDEX idx_bestiary_collections_default;

ALTER TABLE bestiary_collections DROP COLUMN is_default;

COMMIT;
