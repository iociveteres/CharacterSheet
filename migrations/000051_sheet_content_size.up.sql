-- NOT VALID: the sheets already stored are not checked, every write is.
ALTER TABLE character_sheets
    ADD CONSTRAINT content_size CHECK (octet_length(content::text) <= 524288) NOT VALID;
