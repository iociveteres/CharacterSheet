BEGIN;

DROP INDEX forum_topics_author_created_idx;

CREATE INDEX forum_posts_author_idx ON forum_posts (author_id);
DROP INDEX forum_posts_author_created_idx;

COMMIT;
