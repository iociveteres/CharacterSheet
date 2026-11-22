-- 1. Create the character sheet table
CREATE TABLE charactersheets (
    id      SERIAL PRIMARY KEY,
    title   VARCHAR(100) NOT NULL,
    content TEXT            NOT NULL,
    created TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires TIMESTAMPTZ     NOT NULL
);

-- 2. Index on the created timestamp
CREATE INDEX idx_charactersheet_created
    ON charactersheets(created);

-- 3. Create the users table, its status and token types as in production
-- (migrations 000006, 000011, 000061, 000063)
CREATE TYPE user_status AS ENUM ('pending', 'email_verified', 'disabled', 'banned', 'deleting', 'deleted');
CREATE TYPE token_scope AS ENUM ('verification', 'change_password', 'delete_account', 'cancel_deletion',
    'change_email_old', 'change_email_new', 'revert_email');

CREATE TABLE users (
    id              SERIAL      PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    hashed_password CHAR(60)     NOT NULL,
    created         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- The column of the real table, which UserModel.Insert writes.
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    locale          TEXT         NULL,
    status          user_status  NOT NULL DEFAULT 'pending',
    deleted_at      TIMESTAMPTZ  NULL
);

-- Names unique regardless of case, and their history (migration 000063)
CREATE UNIQUE INDEX users_name_key ON users (lower(name COLLATE "und-x-icu")) WHERE name <> '';

CREATE TABLE user_name_history (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_name_history_user_id_changed_at_idx ON user_name_history (user_id, changed_at DESC);

-- 4. Seed a user record: a confirmed account, which GetLocale finds
INSERT INTO users (name, email, hashed_password, created, status) VALUES (
    'Alice Jones',
    'alice@example.com',
    '$2a$12$NuTjWXm3KKntReFwyBVHyuf/to.HEwTy.eS206TNfkGfr6HzGJSWG',
    TIMESTAMPTZ '2022-01-01 10:00:00+00',
    'email_verified'
);
