BEGIN;

-- An enum value can't be dropped without recreating the type, so the new ones
-- stay; no row keeps them. Pending deletions go with their table, and a
-- tombstone becomes a disabled account.
UPDATE users SET status = 'email_verified' WHERE status = 'deleting';
UPDATE users SET status = 'disabled' WHERE status = 'deleted';
DELETE FROM tokens WHERE scope IN ('delete_account', 'cancel_deletion');

DROP TABLE IF EXISTS account_deletions;
ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;

COMMIT;
