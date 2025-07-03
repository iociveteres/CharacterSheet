package models

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SheetModelInterface interface {
	Insert(ctx context.Context, title string, content string, expires int) (int, error)
	Get(ctx context.Context, id int) (*Sheet, error)
	Latest(ctx context.Context) ([]*Sheet, error)
}

type Sheet struct {
	ID      int
	Title   string
	Content string
	Created time.Time
	Expires time.Time
}

type SheetModel struct {
	DB *pgxpool.Pool
}

func (m *SheetModel) Insert(ctx context.Context, title string, content string, expires int) (int, error) {
	stmt := `
INSERT INTO sheets (title, content, created, expires)
VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 day'))
RETURNING id`

	var id int
	// QueryRow will run the INSERT and scan the returned id
	err := m.DB.QueryRow(ctx, stmt, title, content, expires).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (m *SheetModel) Get(ctx context.Context, id int) (*Sheet, error) {
	const stmt = `
SELECT id, title, content, created, expires
  FROM sheets
 WHERE expires > CURRENT_TIMESTAMP
   AND id = $1`

	row := m.DB.QueryRow(ctx, stmt, id)

	s := &Sheet{}
	err := row.Scan(
		&s.ID,
		&s.Title,
		&s.Content,
		&s.Created,
		&s.Expires,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}
	return s, nil
}

func (m *SheetModel) Latest(ctx context.Context) ([]*Sheet, error) {
	stmt := `
SELECT id, title, content, created, expires
  FROM sheets
 WHERE expires > CURRENT_TIMESTAMP
 ORDER BY id DESC
 LIMIT 10`

	rows, err := m.DB.Query(ctx, stmt)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sheets := []*Sheet{}

	for rows.Next() {
		s := &Sheet{}
		if err := rows.Scan(
			&s.ID,
			&s.Title,
			&s.Content,
			&s.Created,
			&s.Expires,
		); err != nil {
			return nil, err
		}
		sheets = append(sheets, s)
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return sheets, nil
}
