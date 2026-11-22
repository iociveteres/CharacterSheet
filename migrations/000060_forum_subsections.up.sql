-- A subsection is a section with a parent, one level deep (_prd/forum/subsections): the depth is
-- checked by the moderators' form under FOR UPDATE (section_moderation.go), not here. position is
-- the place among siblings: among the top level, or inside the parent.
ALTER TABLE forum_sections ADD COLUMN parent_id int REFERENCES forum_sections(id);
ALTER TABLE forum_sections ADD CONSTRAINT forum_sections_not_own_parent CHECK (parent_id <> id);
CREATE INDEX forum_sections_parent_idx ON forum_sections (parent_id);
