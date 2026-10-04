BEGIN;

-- The user who made a creature or an NPC: a copy keeps its source's, so
-- the bestiary names them under the creatures of others. A room's sheet has
-- none, its owner made it. The name goes when the account does.
ALTER TABLE character_sheets ADD COLUMN author_id INT REFERENCES users(id) ON DELETE SET NULL;

-- The author an uploaded file names, as text: nobody can check it. A copy
-- keeps it as it keeps author_id; a sheet has at most one of the two.
ALTER TABLE character_sheets ADD COLUMN author_label TEXT;

CREATE INDEX idx_character_sheets_author_id ON character_sheets(author_id);

-- Until now a copy of another user's creature kept only the label
-- "collection · author"; a name more than one user has falls to the owner.
UPDATE character_sheets cs
SET author_id = COALESCE(
    (SELECT min(u.id) FROM users u
     WHERE u.name = substring(cs.source_label FROM ' · ([^·]*)$')
     HAVING count(*) = 1),
    cs.owner_id)
WHERE cs.room_id IS NULL;

ALTER TABLE character_sheets
    ADD CONSTRAINT one_author CHECK (num_nonnulls(author_id, author_label) <= 1);

-- Deleting a sheet sets source_sheet_id of its copies to NULL: without the
-- index each delete scans the table for them.
CREATE INDEX idx_character_sheets_source_sheet_id ON character_sheets(source_sheet_id);

COMMIT;
