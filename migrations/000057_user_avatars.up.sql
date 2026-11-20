BEGIN;

-- The site's avatar of a user: public, shown by the forum beside the user's
-- posts. One row per user, the image in it: an avatar is not copied as a
-- sheet's portrait is, and two users rarely share one. The hash, the first 16
-- hex of the sha256 of the data, is the image's URL and its version for the
-- browser's cache.
CREATE TABLE user_avatars (
    user_id    int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hash       text NOT NULL,
    mime       text NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg')),
    data       bytea NOT NULL CHECK (octet_length(data) <= 65536),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_avatars_hash ON user_avatars(hash);

-- A moderator's lock on uploading a new avatar after removing one. A lock
-- whose until has passed no longer holds: the queries compare it with now(),
-- no job deletes it. NULL until is for good.
CREATE TABLE user_avatar_locks (
    user_id      int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    until        timestamptz,
    reason       text NOT NULL,
    moderator_id int NOT NULL REFERENCES users(id),
    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMIT;
