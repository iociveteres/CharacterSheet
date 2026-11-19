BEGIN;

-- Who gets the replies of a topic: its author from the start, anyone else by the button
-- "Subscribe" (decision 11 of _prd/forum/plan.md, changed on 2026-11-19: a reply does not
-- subscribe). The replies of a topic go to its subscribers by topic_id.
CREATE TABLE forum_subscriptions (
    user_id    int NOT NULL REFERENCES users(id),
    topic_id   int NOT NULL REFERENCES forum_topics(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, topic_id)
);

CREATE INDEX forum_subscriptions_topic_idx ON forum_subscriptions (topic_id);

-- A notification keeps its kind and parameters, never a phrase: the page words it in the reader's
-- language (internal/forum/notifications.go lists the kinds). kind is a stored code: never rename
-- one. params keep what the targets may no longer show: the title of the topic at the time, the
-- reason and term of a moderator. Replies to one topic gather into one unread row: count grows,
-- post_id stays the first of them; updated_at is the time of the last.
CREATE TABLE forum_notifications (
    id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    int NOT NULL REFERENCES users(id),
    kind       text NOT NULL,
    topic_id   int REFERENCES forum_topics(id),
    post_id    int REFERENCES forum_posts(id),
    count      int NOT NULL DEFAULT 1,
    params     jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    read_at    timestamptz
);

-- One unread notification of replies per user and topic: a reply adds to it by ON CONFLICT.
CREATE UNIQUE INDEX forum_notifications_replies_idx ON forum_notifications (user_id, topic_id)
    WHERE kind = 'replies' AND read_at IS NULL;

-- The counter of the site nav and the unread notifications of a topic its reader has read.
CREATE INDEX forum_notifications_unread_idx ON forum_notifications (user_id, topic_id)
    WHERE read_at IS NULL;

-- The page of a user's notifications, the newest first, and the removal of their old read ones.
CREATE INDEX forum_notifications_user_idx ON forum_notifications (user_id, updated_at);

COMMIT;
