BEGIN;

-- The new values aren't used in this transaction: Postgres doesn't allow it
-- right after ADD VALUE. change_email_old and change_email_new confirm a new
-- address from the old mailbox and then from the new one; revert_email goes to
-- the old address after the change and puts it back.
ALTER TYPE token_scope ADD VALUE IF NOT EXISTS 'change_email_old';
ALTER TYPE token_scope ADD VALUE IF NOT EXISTS 'change_email_new';
ALTER TYPE token_scope ADD VALUE IF NOT EXISTS 'revert_email';

-- The address a token is about: the new one for change_email_*, the one to put
-- back for revert_email; NULL for the other scopes. A live revert_email keeps
-- its address from being taken by anyone else.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS email text;

-- IF NOT EXISTS here and below: the models' test schema
-- (internal/models/testdata/setup.sql) already has the table and the index and
-- runs this migration on top of it.
--
-- Every former name of a user, public on the forum and kept until the account
-- is wiped (a tombstone keeps its row, so the wipe deletes these itself).
-- Changing only the case writes no row.
CREATE TABLE IF NOT EXISTS user_name_history (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_name_history_user_id_changed_at_idx
    ON user_name_history (user_id, changed_at DESC);

-- Names are trimmed on input from now on. A name of blanks only stays: an empty
-- one marks a tombstone.
UPDATE users SET name = btrim(name, E' \t\n\r\f\v')
WHERE name <> btrim(name, E' \t\n\r\f\v') AND btrim(name, E' \t\n\r\f\v') <> '';

-- Names equal but for case: the oldest account keeps it, the others become
-- "<name> #<id>", cut to fit 64, and find the former name in their history.
-- The CTEs see the users before the UPDATE, so the history gets the old names.
WITH taken AS (
    SELECT id, name,
           row_number() OVER (PARTITION BY lower(name COLLATE "und-x-icu") ORDER BY id) AS n
    FROM users
    WHERE name <> ''
), history AS (
    INSERT INTO user_name_history (user_id, name)
    SELECT id, name FROM taken WHERE n > 1
)
UPDATE users u
SET name = rtrim(left(t.name, 64 - length(' #' || t.id))) || ' #' || t.id
FROM taken t
WHERE u.id = t.id AND t.n > 1;

-- A "<name> #<id>" may itself be someone's name: such cases are sorted out by hand.
DO $$
DECLARE
    clashes text;
BEGIN
    SELECT string_agg(ids::text, ', ') INTO clashes
    FROM (
        SELECT array_agg(id ORDER BY id) AS ids
        FROM users
        WHERE name <> ''
        GROUP BY lower(name COLLATE "und-x-icu")
        HAVING count(*) > 1
    ) c;
    IF clashes IS NOT NULL THEN
        RAISE EXCEPTION 'users whose names still differ only in case: %', clashes;
    END IF;
END $$;

-- ICU explicitly: lower() follows the database's lc_ctype otherwise, and with
-- the C locale leaves Cyrillic as it is. Tombstones (empty names) don't count.
CREATE UNIQUE INDEX IF NOT EXISTS users_name_key
    ON users (lower(name COLLATE "und-x-icu")) WHERE name <> '';

COMMIT;
