BEGIN;

-- The enum values stay, as in 000061: dropping one recreates the type. No row
-- keeps them. Names renamed by the up migration aren't restored.
DELETE FROM tokens WHERE scope IN ('change_email_old', 'change_email_new', 'revert_email');
ALTER TABLE tokens DROP COLUMN IF EXISTS email;

DROP INDEX IF EXISTS users_name_key;
DROP TABLE IF EXISTS user_name_history;

COMMIT;
