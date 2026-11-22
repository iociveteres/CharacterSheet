BEGIN;

-- A ban stops a user writing on the forum; they still read it. It stands while lifted_at is NULL
-- and expires_at (NULL: until lifted) is in the future, so an expired ban ends by itself, without a
-- job. A user may have rows of past bans; the forum takes the one that ends last.
CREATE TABLE forum_bans (
    id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      int NOT NULL REFERENCES users(id),
    moderator_id int NOT NULL REFERENCES users(id),
    -- Shown to the banned user; required (decision 10 of _prd/forum/plan.md).
    reason       text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz,
    lifted_at    timestamptz,
    lifted_by    int REFERENCES users(id)
);

-- The viewer's ban and the list of standing bans read only the rows not lifted.
CREATE INDEX forum_bans_user_idx ON forum_bans (user_id) WHERE lifted_at IS NULL;

-- Every moderator action, written in the transaction of its change (internal/forum/moderation.go).
-- action is a stored code ('topic.rename', …): never rename one. The target is a column per kind,
-- with a key, so the log links what still exists (nothing of the forum is deleted for good); an
-- action fills the ones it has: a post also names its topic, a ban its user and the post it was
-- given from. data keeps what the target no longer shows: the title before a rename, the section a
-- topic left, the term of a ban.
CREATE TABLE forum_mod_log (
    id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    moderator_id int NOT NULL REFERENCES users(id),
    action       text NOT NULL,
    topic_id     int REFERENCES forum_topics(id),
    post_id      int REFERENCES forum_posts(id),
    section_id   int REFERENCES forum_sections(id),
    user_id      int REFERENCES users(id),
    reason       text NOT NULL DEFAULT '',
    data         jsonb NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Who deleted a topic or a post and why, for the moderator's view of it. The log page pages by id.
CREATE INDEX forum_mod_log_topic_idx ON forum_mod_log (topic_id) WHERE topic_id IS NOT NULL;
CREATE INDEX forum_mod_log_post_idx ON forum_mod_log (post_id) WHERE post_id IS NOT NULL;

COMMIT;
