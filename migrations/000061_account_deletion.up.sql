BEGIN;

-- The new values aren't used in this transaction: Postgres doesn't allow it
-- right after ADD VALUE. deleting is an account waiting out its grace period
-- (GetLocale lets no session of it in), deleted is the wiped row that stays as
-- a tombstone.
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'deleting';
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'deleted';
ALTER TYPE token_scope ADD VALUE IF NOT EXISTS 'delete_account';
ALTER TYPE token_scope ADD VALUE IF NOT EXISTS 'cancel_deletion';

-- IF NOT EXISTS: the models' test schema (internal/models/testdata/setup.sql)
-- already has the column and runs this migration on top of it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- A deletion the user scheduled. It waits while wiped_at IS NULL (the user is
-- deleting then; cancelling deletes the row and restores email_verified in one
-- transaction); the choices from the deletion page apply at the wipe. After
-- the wipe the row stays: it holds no personal data, and the deletion is
-- repeated from it after a restore from a backup.
CREATE TABLE account_deletions (
    user_id                   int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    requested_at              timestamptz NOT NULL DEFAULT now(),
    delete_at                 timestamptz NOT NULL,
    delete_chat_messages      boolean NOT NULL DEFAULT false,
    wipe_forum_posts          boolean NOT NULL DEFAULT false,
    delete_public_collections boolean NOT NULL DEFAULT false,
    -- {"<room_id>": <user_id>}: who gets each room the user shares with others.
    heirs                     jsonb NOT NULL DEFAULT '{}',
    -- The "deleting tomorrow" email went out; the wipe waits a day after it.
    reminded_at               timestamptz,
    wiped_at                  timestamptz
);

CREATE INDEX account_deletions_due_idx ON account_deletions (delete_at) WHERE wiped_at IS NULL;

COMMIT;
