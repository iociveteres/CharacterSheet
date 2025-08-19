package models

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RoomModelInterface interface {
	Create(ctx context.Context, userId int, content string) (int, error)
	Get(ctx context.Context, id int) (*Room, error)
	ByUser(ctx context.Context, userId int) ([]*Room, error)
}

type Room struct {
	ID        int
	OwnerID   int
	Name      string
	CreatedAt time.Time
}

type RoomModel struct {
	DB *pgxpool.Pool
}

func (m *RoomModel) Create(ctx context.Context, userID int, name string) (int, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}

	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	insertRoom := `
INSERT INTO rooms (owner_id, name, created_at)
VALUES ($1, $2, CURRENT_TIMESTAMP)
RETURNING id;
`
	var roomID int
	if err = tx.QueryRow(ctx, insertRoom, userID, name).Scan(&roomID); err != nil {
		return 0, err
	}

	insertMember := `
INSERT INTO room_members (room_id, user_id, role, joined_at)
VALUES ($1, $2, $3, CURRENT_TIMESTAMP);
`
	if _, err = tx.Exec(ctx, insertMember, roomID, userID, "gamemaster"); err != nil {
		return 0, err
	}

	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}

	return roomID, nil
}

func (m *RoomModel) Get(ctx context.Context, id int) (*Room, error) {
	const stmt = `
	SELECT id, 
		owner_id, 
		name, 
		created_at
	FROM rooms
	WHERE id = $1`

	row := m.DB.QueryRow(ctx, stmt, id)

	s := &Room{}
	err := row.Scan(
		&s.ID,
		&s.OwnerID,
		&s.Name,
		&s.CreatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}
	return s, nil
}

func (m *RoomModel) ByUser(ctx context.Context, ownerId int) ([]*Room, error) {
	const stmt = `
	SELECT r.id, 
		r.name, 
		r.created_at 
FROM rooms r
JOIN room_members rm ON r.id = rm.room_id
WHERE rm.user_id = $1;`

	rows, err := m.DB.Query(ctx, stmt, ownerId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rooms := []*Room{}

	for rows.Next() {
		s := &Room{}
		if err := rows.Scan(
			&s.ID,
			&s.Name,
			&s.CreatedAt,
		); err != nil {
			return nil, err
		}
		rooms = append(rooms, s)
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return rooms, nil
}
}
