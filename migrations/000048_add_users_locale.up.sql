-- The interface language the user picked; null: the browser's language decides.
ALTER TABLE users ADD COLUMN locale TEXT NULL;
