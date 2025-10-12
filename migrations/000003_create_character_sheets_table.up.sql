BEGIN;

CREATE TABLE character_sheets (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id INT NOT NULL REFERENCES users(id),
    room_id INT NOT NULL REFERENCES rooms(id),
    content JSONB NOT NULL DEFAULT '{}' :: jsonb,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_character_sheets_owner_id ON character_sheets(owner_id);

CREATE INDEX idx_character_sheets_room_id ON character_sheets(room_id);

COMMIT;