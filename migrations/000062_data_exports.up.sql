BEGIN;

-- A user's data export: one row per user, queued, built in the background into
-- a file named file_name and kept for a day once ready.
CREATE TABLE data_exports (
    user_id      int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state        text NOT NULL CHECK (state IN ('queued', 'building', 'ready', 'failed')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    ready_at     timestamptz,
    file_name    text,
    size         bigint
);

CREATE INDEX data_exports_queue_idx ON data_exports (requested_at) WHERE state = 'queued';

COMMIT;
