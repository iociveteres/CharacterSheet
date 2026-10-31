BEGIN;

-- Portraits live apart from the content of a sheet: every edit of a field
-- rewrites the whole content, which would rewrite the image too. An image is
-- stored once, by the first 16 hex of the sha256 of its data, and sheets link
-- to it: ten copies of one creature are ten links and one image. The hash is
-- also the image's version in its URL: a new image is a new URL.
CREATE TABLE portrait_images (
    hash text PRIMARY KEY,
    mime text NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg')),
    data bytea NOT NULL CHECK (octet_length(data) <= 131072)
);

CREATE TABLE sheet_portraits (
    sheet_id   int PRIMARY KEY REFERENCES character_sheets(id) ON DELETE CASCADE,
    hash       text NOT NULL REFERENCES portrait_images(hash),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sheet_portraits_hash ON sheet_portraits(hash);

-- An image goes with its last link. Deleting a sheet, an encounter or a
-- collection cascades to the links, so this covers them too.
CREATE FUNCTION delete_unlinked_portrait() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM portrait_images p
    WHERE p.hash = OLD.hash
      AND NOT EXISTS (SELECT 1 FROM sheet_portraits sp WHERE sp.hash = OLD.hash);
    RETURN NULL;
EXCEPTION
    -- A link to the image added by a transaction that committed meanwhile:
    -- the image stays.
    WHEN foreign_key_violation THEN
        RETURN NULL;
END $$;

CREATE TRIGGER sheet_portraits_unlinked
AFTER DELETE OR UPDATE OF hash ON sheet_portraits
FOR EACH ROW EXECUTE FUNCTION delete_unlinked_portrait();

COMMIT;
