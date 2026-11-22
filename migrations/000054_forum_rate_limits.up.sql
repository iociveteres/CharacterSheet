BEGIN;

-- The limits of how often one writes (internal/forum/ratelimit.go) look up an author's newest posts
-- and topics. The posts index replaces forum_posts_author_idx: its first column still serves the
-- number of posts next to an author's name.
CREATE INDEX forum_posts_author_created_idx ON forum_posts (author_id, created_at);
DROP INDEX forum_posts_author_idx;

CREATE INDEX forum_topics_author_created_idx ON forum_topics (author_id, created_at);

COMMIT;
