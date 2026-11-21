package models

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The queue of the data exports (plan _prd/account_deletion, section 6.2): one row per user in
// data_exports, queued → building → ready | failed. The archive itself is built by webapp.

// The states of a data export.
const (
	ExportQueued   = "queued"
	ExportBuilding = "building"
	ExportReady    = "ready"
	ExportFailed   = "failed"
)

// ExportEvery is how often a user may have an archive built (decision 14); a failed build does
// not count.
const ExportEvery = 30 * time.Minute

// DataExport is the export of a user's data as the export page shows it.
type DataExport struct {
	State       string
	RequestedAt time.Time
	ReadyAt     *time.Time
	// The archive in the export folder, "" until it is ready.
	FileName string
	Size     int64
	// Ahead is how many queued exports were asked for earlier; 0 unless queued.
	Ahead int
}

// ExportTooSoonError refuses an archive asked for within ExportEvery of the last one.
type ExportTooSoonError struct {
	Until time.Time
}

func (e *ExportTooSoonError) Error() string {
	return fmt.Sprintf("models: data export too soon, next after %s", e.Until.Format(time.RFC3339))
}

type DataExportModelInterface interface {
	Get(ctx context.Context, userID int) (*DataExport, error)
	Request(ctx context.Context, userID int) (oldFile string, err error)
	Discard(ctx context.Context, userID int, fileName string) error
	Claim(ctx context.Context) (int, error)
	Finish(ctx context.Context, userID int, fileName string, size int64) error
	Fail(ctx context.Context, userID int) error
	Requeue(ctx context.Context, userID int) error
	RequeueBuilding(ctx context.Context) (int, error)
	DeleteExpired(ctx context.Context, olderThan time.Duration) ([]string, error)
	ExportContentInterface
}

type DataExportModel struct {
	DB *pgxpool.Pool
}

// Get is the user's export with its place in the queue; ErrNoRecord without one.
func (m *DataExportModel) Get(ctx context.Context, userID int) (*DataExport, error) {
	e := &DataExport{}
	var file *string
	var size *int64
	err := m.DB.QueryRow(ctx, `
SELECT d.state, d.requested_at, d.ready_at, d.file_name, d.size,
    CASE WHEN d.state = 'queued' THEN
        (SELECT count(*) FROM data_exports q WHERE q.state = 'queued' AND (q.requested_at, q.user_id) < (d.requested_at, d.user_id))
    ELSE 0 END
FROM data_exports d WHERE d.user_id = $1`, userID).
		Scan(&e.State, &e.RequestedAt, &e.ReadyAt, &file, &size, &e.Ahead)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	if err != nil {
		return nil, err
	}
	if file != nil {
		e.FileName = *file
	}
	if size != nil {
		e.Size = *size
	}
	return e, nil
}

// Request queues an export of the user's data. An export queued or being built stays as it is;
// a ready one within ExportEvery of its request refuses with an ExportTooSoonError; a failed one,
// or a ready one older than that, is queued again, and oldFile is its archive for the caller to
// delete.
func (m *DataExportModel) Request(ctx context.Context, userID int) (string, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var state string
	var file *string
	var until time.Time
	var tooSoon bool
	err = tx.QueryRow(ctx, `
SELECT state, file_name, requested_at + make_interval(secs => $2), requested_at + make_interval(secs => $2) > now()
FROM data_exports WHERE user_id = $1
FOR UPDATE`, userID, ExportEvery.Seconds()).Scan(&state, &file, &until, &tooSoon)
	if errors.Is(err, pgx.ErrNoRows) {
		// Two requests at once: the second finds the first's row.
		if _, err := tx.Exec(ctx, `INSERT INTO data_exports (user_id, state) VALUES ($1, 'queued') ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
			return "", err
		}
		return "", tx.Commit(ctx)
	}
	if err != nil {
		return "", err
	}
	switch {
	case state == ExportQueued || state == ExportBuilding:
		return "", nil
	case state == ExportReady && tooSoon:
		return "", &ExportTooSoonError{Until: until}
	}
	if _, err := tx.Exec(ctx, `
UPDATE data_exports
SET state = 'queued', requested_at = now(), started_at = NULL, ready_at = NULL, file_name = NULL, size = NULL
WHERE user_id = $1`, userID); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	if file == nil {
		return "", nil
	}
	return *file, nil
}

// Discard forgets the user's ready export whose archive is gone (a restart empties /tmp): the
// page then shows none, and ExportEvery does not hold back a new one.
func (m *DataExportModel) Discard(ctx context.Context, userID int, fileName string) error {
	_, err := m.DB.Exec(ctx, `DELETE FROM data_exports WHERE user_id = $1 AND state = 'ready' AND file_name = $2`, userID, fileName)
	return err
}

// Claim takes the export asked for first among the queued and marks it building; it returns the
// user, ErrNoRecord when the queue is empty. SKIP LOCKED lets the workers claim at once.
func (m *DataExportModel) Claim(ctx context.Context) (int, error) {
	var userID int
	err := m.DB.QueryRow(ctx, `
UPDATE data_exports SET state = 'building', started_at = now()
WHERE user_id = (
    SELECT user_id FROM data_exports WHERE state = 'queued'
    ORDER BY requested_at, user_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING user_id`).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNoRecord
	}
	return userID, err
}

// Finish marks the user's export ready with its archive. ErrNoRecord when it is no longer being
// built: the account was wiped meanwhile, and the caller deletes the archive.
func (m *DataExportModel) Finish(ctx context.Context, userID int, fileName string, size int64) error {
	tag, err := m.DB.Exec(ctx, `
UPDATE data_exports SET state = 'ready', ready_at = now(), file_name = $2, size = $3
WHERE user_id = $1 AND state = 'building'`, userID, fileName, size)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNoRecord
	}
	return nil
}

// Fail marks the user's export as failed; the page offers to try again at once.
func (m *DataExportModel) Fail(ctx context.Context, userID int) error {
	_, err := m.DB.Exec(ctx, `UPDATE data_exports SET state = 'failed' WHERE user_id = $1 AND state = 'building'`, userID)
	return err
}

// Requeue puts back into the queue the user's export whose build the server's stop cut short.
func (m *DataExportModel) Requeue(ctx context.Context, userID int) error {
	_, err := m.DB.Exec(ctx, `UPDATE data_exports SET state = 'queued', started_at = NULL WHERE user_id = $1 AND state = 'building'`, userID)
	return err
}

// RequeueBuilding puts back into the queue, at the server's start, the exports a previous run
// was building when it stopped.
func (m *DataExportModel) RequeueBuilding(ctx context.Context) (int, error) {
	tag, err := m.DB.Exec(ctx, `UPDATE data_exports SET state = 'queued', started_at = NULL WHERE state = 'building'`)
	return int(tag.RowsAffected()), err
}

// DeleteExpired deletes the exports ready or failed longer than olderThan ago and returns the
// archives to delete.
func (m *DataExportModel) DeleteExpired(ctx context.Context, olderThan time.Duration) ([]string, error) {
	rows, err := m.DB.Query(ctx, `
DELETE FROM data_exports
WHERE (state = 'ready' AND ready_at < now() - make_interval(secs => $1))
   OR (state = 'failed' AND requested_at < now() - make_interval(secs => $1))
RETURNING file_name`, olderThan.Seconds())
	if err != nil {
		return nil, err
	}
	files, err := pgx.CollectRows(rows, pgx.RowTo[*string])
	if err != nil {
		return nil, err
	}
	var names []string
	for _, f := range files {
		if f != nil {
			names = append(names, *f)
		}
	}
	return names, nil
}
