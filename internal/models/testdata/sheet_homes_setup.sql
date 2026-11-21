-- The tables the sheet homes stand on, as they are before migration 000032;
-- the tests then run that migration, so its tables and permission functions
-- are the real ones.
CREATE TYPE room_role AS ENUM ('gamemaster', 'moderator', 'player');
CREATE TYPE sheet_visibility AS ENUM ('everyone_can_edit', 'everyone_can_view', 'everyone_can_see', 'hide_from_players');
CREATE TYPE sheet_kind AS ENUM ('black_crusade', 'pathfinder_crusade');

CREATE TABLE rooms (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
);

CREATE TABLE room_members (
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role    room_role NOT NULL,
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE character_sheet_folders (
    id                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id           INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    folder_visibility sheet_visibility NOT NULL DEFAULT 'everyone_can_view'
);

-- owner_id without ON DELETE CASCADE, as in production (000003): deleting a
-- user who still owns sheets fails.
CREATE TABLE character_sheets (
    id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id         INT NOT NULL REFERENCES users(id),
    room_id          INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    content          JSONB NOT NULL DEFAULT '{"characterInfo": {"characterName": ""}}',
    sheet_visibility sheet_visibility NOT NULL DEFAULT 'everyone_can_view',
    sheet_kind       sheet_kind NOT NULL DEFAULT 'black_crusade',
    folder_id        INT REFERENCES character_sheet_folders(id) ON DELETE SET NULL,
    version          INT NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The chat as it is before migration 000049.
CREATE TABLE room_messages (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id        INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id        INT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    message_body   TEXT NOT NULL,
    command_result TEXT,
    character_name TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
