BEGIN;

-- Shared collections (_prd/gm_mode/data-model.md): a public one is in the
-- catalog and seen by everyone.
CREATE TYPE collection_visibility AS ENUM ('private', 'public');

ALTER TABLE bestiary_collections
    ADD COLUMN visibility   collection_visibility NOT NULL DEFAULT 'private',
    -- Set each time the collection becomes public: the catalog's order.
    ADD COLUMN published_at TIMESTAMPTZ;

CREATE INDEX idx_bestiary_collections_catalog ON bestiary_collections(published_at DESC) WHERE visibility = 'public';

-- A public collection of another user in the list of the bestiary page. It
-- gives no access: while the collection is private it stays, unlisted.
CREATE TABLE bestiary_subscriptions (
    user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection_id INT NOT NULL REFERENCES bestiary_collections(id) ON DELETE CASCADE,
    subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, collection_id)
);

CREATE INDEX idx_bestiary_subscriptions_collection_id ON bestiary_subscriptions(collection_id);

-- A creature is seen by everyone in a public collection; edited still by the
-- owner only.
CREATE OR REPLACE FUNCTION can_view_character_sheet(p_user_id INT, p_sheet_id INT)
RETURNS BOOLEAN AS $$
SELECT
    EXISTS (
        SELECT 1
        FROM character_sheets cs
        LEFT JOIN character_sheet_folders f ON f.id = cs.folder_id
        LEFT JOIN room_members rm ON rm.room_id = cs.room_id AND rm.user_id = p_user_id
        WHERE cs.id = p_sheet_id
        AND cs.room_id IS NOT NULL
        AND (
            -- Owner can always view
            cs.owner_id = p_user_id
            -- Gamemaster can always view
            OR rm.role = 'gamemaster'
            -- Moderator can view
            OR rm.role = 'moderator'
            -- Regular members: check folder visibility first, then sheet visibility
            OR (
                rm.user_id IS NOT NULL
                AND (
                    -- If in folder, folder visibility overrides
                    (cs.folder_id IS NOT NULL AND f.folder_visibility IN ('everyone_can_edit', 'everyone_can_view'))
                    -- If not in folder, use sheet visibility
                    OR (cs.folder_id IS NULL AND cs.sheet_visibility IN ('everyone_can_edit', 'everyone_can_view'))
                )
            )
        )
    )
    OR EXISTS (
        SELECT 1
        FROM character_sheets cs
        JOIN encounters e ON e.id = cs.encounter_id
        JOIN room_members rm ON rm.room_id = e.room_id AND rm.user_id = p_user_id
        WHERE cs.id = p_sheet_id
        AND rm.role = 'gamemaster'
    )
    OR EXISTS (
        SELECT 1
        FROM character_sheets cs
        JOIN bestiary_collections c ON c.id = cs.collection_id
        WHERE cs.id = p_sheet_id
        AND (c.owner_id = p_user_id OR c.visibility = 'public')
    );
$$ LANGUAGE sql STABLE;

COMMIT;
