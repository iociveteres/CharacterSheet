BEGIN;

ALTER TYPE token_scope ADD VALUE IF NOT EXISTS 'change_password';

COMMIT;