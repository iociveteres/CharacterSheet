BEGIN;

-- A user's «О себе» on their forum page (_prd/forum/extras/users.md): their own forum Markdown, up to
-- 500 characters. It is the forum's, as posts are, not a setting of the site. A moderator erases it
-- with a reason: the text goes, the reason stays in forum_mod_log (about.erase), and the page shows
-- «erased» while the last erase is not older than updated_at.
CREATE TABLE forum_profiles (
    user_id    int PRIMARY KEY REFERENCES users(id),
    about      text NOT NULL DEFAULT '' CHECK (char_length(about) <= 500),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- The log of one user for their page and the filter ?user= of the log.
CREATE INDEX forum_mod_log_user_idx ON forum_mod_log (user_id, id) WHERE user_id IS NOT NULL;

COMMIT;
