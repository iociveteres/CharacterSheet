BEGIN;

-- How far a user has read a topic: every post with an id up to last_read_post_id. Post ids grow
-- with time, so the mark only moves forward (internal/forum/reads.go).
CREATE TABLE forum_topic_reads (
    user_id           int NOT NULL REFERENCES users(id),
    topic_id          int NOT NULL REFERENCES forum_topics(id),
    last_read_post_id int NOT NULL,
    PRIMARY KEY (user_id, topic_id)
);

-- "Mark as read" of a section, or of the whole forum when section_id is NULL: every post with an
-- id up to post_id is read. NULLS NOT DISTINCT keeps one forum-wide row per user, and one
-- ON CONFLICT (user_id, section_id) serves both kinds.
CREATE TABLE forum_read_marks (
    user_id    int NOT NULL REFERENCES users(id),
    section_id int REFERENCES forum_sections(id),
    post_id    int NOT NULL,
    UNIQUE NULLS NOT DISTINCT (user_id, section_id)
);

COMMIT;
