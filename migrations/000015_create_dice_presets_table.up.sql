BEGIN;

ALTER TABLE
    room_members
ADD
    COLUMN dice_amount INT NOT NULL DEFAULT 1 CHECK (
        dice_amount BETWEEN 1
        AND 5
    );

CREATE TABLE dice_presets (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot_number INT NOT NULL CHECK (
        slot_number BETWEEN 1
        AND 5
    ),
    dice_notation TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(room_id, user_id, slot_number)
);

CREATE INDEX idx_dice_presets_user ON dice_presets(user_id);

END;