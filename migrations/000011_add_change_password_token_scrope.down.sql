BEGIN;

-- 1) Remove any tokens that use the value we will remove.
DELETE FROM tokens
WHERE scope = 'change_password';

-- 2) Create a new enum type that contains only the remaining values.
CREATE TYPE token_scope_new AS ENUM ('verification');

-- 3) Switch the column to the new type (cast via text).
ALTER TABLE tokens
  ALTER COLUMN scope TYPE token_scope_new
  USING scope::text::token_scope_new;

-- 4) Drop the old type and rename the new one to the original name.
DROP TYPE token_scope;
ALTER TYPE token_scope_new RENAME TO token_scope;

COMMIT;