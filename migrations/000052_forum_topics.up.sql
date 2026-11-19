BEGIN;

-- reply_count, last_post_id and last_post_at are counted from forum_posts by recountTopic
-- (internal/forum/topics.go) in the transaction that changes the posts; never add to them by hand.
CREATE TABLE forum_topics (
    id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    section_id   int NOT NULL REFERENCES forum_sections(id),
    author_id    int NOT NULL REFERENCES users(id),
    title        text NOT NULL,
    pinned       boolean NOT NULL DEFAULT false,
    -- Only moderators reply in a closed topic.
    closed       boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- Soft delete: only moderators see a deleted topic, and only SQL brings it back.
    deleted_at   timestamptz,
    deleted_by   int REFERENCES users(id),
    -- Visible posts after the first one.
    reply_count  int NOT NULL DEFAULT 0,
    -- The last visible post; NULL when every post is deleted. No foreign key: forum_posts refers
    -- here, and a cycle would only make the down migration and inserts order-sensitive.
    last_post_id int,
    -- The time of last_post_id, or created_at without one: the list orders by it.
    last_post_at timestamptz NOT NULL DEFAULT now()
);

-- Topics of a section: pinned first, then by last activity. Not partial on deleted_at: moderators
-- list deleted topics too, and they are few.
CREATE INDEX forum_topics_section_activity_idx
    ON forum_topics (section_id, pinned DESC, last_post_at DESC, id DESC);

-- The forum home: the number of visible topics of a section and its last post.
CREATE INDEX forum_topics_section_last_post_idx
    ON forum_topics (section_id, last_post_at DESC) WHERE deleted_at IS NULL;

-- Ids grow with time: "read up to post N" compares ids.
CREATE TABLE forum_posts (
    id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic_id   int NOT NULL REFERENCES forum_topics(id),
    author_id  int NOT NULL REFERENCES users(id),
    -- Markdown as typed; the HTML is rendered on display.
    body       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at  timestamptz,
    -- Soft delete: the post keeps its place in the topic, its text is hidden.
    deleted_at timestamptz,
    deleted_by int REFERENCES users(id)
);

-- Posts of a topic page and the page of a post: by id within the topic.
CREATE INDEX forum_posts_topic_idx ON forum_posts (topic_id, id);

-- The number of posts next to an author's name.
CREATE INDEX forum_posts_author_idx ON forum_posts (author_id);

COMMIT;
