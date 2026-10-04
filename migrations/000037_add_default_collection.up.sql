BEGIN;

-- "My creatures": a private collection every user has from the start, one a
-- user. New users get it from UserModel.Insert (internal/models/users.go).
ALTER TABLE bestiary_collections
    ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT default_is_private CHECK (NOT is_default OR visibility = 'private');

CREATE UNIQUE INDEX idx_bestiary_collections_default ON bestiary_collections(owner_id) WHERE is_default;

INSERT INTO bestiary_collections (owner_id, name, is_default)
SELECT u.id, 'My creatures', true
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM bestiary_collections c WHERE c.owner_id = u.id AND c.is_default);

COMMIT;
