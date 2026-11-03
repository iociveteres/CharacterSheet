BEGIN;

-- The order of the cards in the columns "Party" and "Enemies", which the
-- gamemaster drags, apart from the turn order: a group of the party has a
-- place in the column of each encounter of the room. A group without one
-- comes last, in the order the groups were made.
CREATE TABLE column_positions (
    encounter_id INT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    group_id     INT NOT NULL REFERENCES initiative_groups(id) ON DELETE CASCADE,
    position     INT NOT NULL,
    PRIMARY KEY (encounter_id, group_id)
);

CREATE INDEX idx_column_positions_group_id ON column_positions(group_id);

-- A column that keeps its cards in turn order instead.
ALTER TABLE encounters
    ADD COLUMN party_by_initiative   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN enemies_by_initiative BOOLEAN NOT NULL DEFAULT false;

COMMIT;
