BEGIN;

CREATE TYPE token_scope AS ENUM ('verification');

CREATE TABLE IF NOT EXISTS tokens (
    hash bytea PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
    expiry timestamp(0) with time zone NOT NULL,
    scope token_scope NOT NULL
);

CREATE TYPE user_status AS ENUM ('pending', 'email_verified', 'disabled', 'banned');

ALTER TABLE
    users
ADD
    COLUMN status user_status NOT NULL DEFAULT 'pending';

END;