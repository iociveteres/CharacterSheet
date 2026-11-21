BEGIN;

-- Section names are one text, as typed, not translated (_prd/forum/plan.md, decision 3).
CREATE TABLE forum_sections (
    id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             text NOT NULL,
    description      text NOT NULL DEFAULT '',
    -- Not unique: reordering would have to dodge the constraint; ties fall back to id.
    position         int NOT NULL,
    -- Only moderators start topics here; anyone signed in still replies.
    mods_only_topics boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- A moderator is a row here; there is no UI to grant it. No ON DELETE: the site deletes no accounts.
CREATE TABLE forum_moderators (
    user_id    int PRIMARY KEY REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO forum_sections (name, description, position, mods_only_topics) VALUES
    ('Новости', 'Обновления сайта и объявления.', 1, true),
    ('Вопросы и помощь', 'Как пользоваться сайтом, комнатами и листами персонажей.', 2, false),
    ('Ошибки и предложения', 'Что сломалось и чего не хватает.', 3, false),
    ('Поиск игры', 'Ищете мастера или игроков — пишите сюда.', 4, false),
    ('Свободная тема', 'Обо всём остальном.', 5, false);

COMMIT;
