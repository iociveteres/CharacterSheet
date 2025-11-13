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
	ByUserWithRole(ctx context.Context, userID int) ([]*RoomWithRole, error)
	HasUser(ctx context.Context, roomID int, userID int) (bool, error)
	PlayersWithSheets(ctx context.Context, roomID int) ([]*PlayerView, error)
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
VALUES ($1, $2, CAST($3 AS room_role), CURRENT_TIMESTAMP);
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

type RoomWithRole struct {
	Room
	UserRole RoomRole
	JoinedAt time.Time
}

func (m *RoomModel) ByUserWithRole(ctx context.Context, userID int) ([]*RoomWithRole, error) {
	const stmt = `
SELECT 
	r.id, 
	r.owner_id,
	r.name, 
	r.created_at,
	rm.role,
	rm.joined_at
FROM rooms r
JOIN room_members rm ON r.id = rm.room_id
WHERE rm.user_id = $1
ORDER BY rm.joined_at DESC;
`

	rows, err := m.DB.Query(ctx, stmt, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rooms := make([]*RoomWithRole, 0)

	for rows.Next() {
		r := &RoomWithRole{}
		if err := rows.Scan(
			&r.ID,
			&r.OwnerID,
			&r.Name,
			&r.CreatedAt,
			&r.UserRole,
			&r.JoinedAt,
		); err != nil {
			return nil, err
		}
		rooms = append(rooms, r)
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return rooms, nil
}

func (m *RoomModel) HasUser(ctx context.Context, roomID int, userID int) (bool, error) {
	const stmt = `
	SELECT EXISTS (
	SELECT 1
	FROM room_members
	WHERE room_id = $1 AND user_id = $2)`

	row := m.DB.QueryRow(ctx, stmt, roomID, userID)

	var exists bool
	err := row.Scan(&exists)

	if err != nil {
		return false, err
	}

	return exists, nil
}

type PlayerView struct {
	User            User
	JoinedAt        time.Time
	Role            RoomRole
	CharacterSheets []CharacterSheet
}

type RoomView struct {
	Room
	Players []PlayerView
}

func (m *RoomModel) PlayersWithSheets(ctx context.Context, roomID int) ([]*PlayerView, error) {
	const stmt = `
SELECT
  u.id                          AS user_id,
  u.name                        AS user_name,
  u.email                       AS user_email,
  rm.joined_at                  AS joined_at,
  rm.role                       AS role,
  cs.id                         AS sheet_id,
  cs.content->'character-info'->>'character-name' AS character_name,
  cs.created_at                 AS sheet_created_at,
  cs.updated_at                 AS sheet_updated_at
FROM room_members rm
JOIN users u ON u.id = rm.user_id
LEFT JOIN character_sheets cs
  ON cs.owner_id = u.id
  AND cs.room_id = rm.room_id
WHERE rm.room_id = $1
ORDER BY rm.joined_at ASC, cs.updated_at DESC NULLS LAST;
`

	rows, err := m.DB.Query(ctx, stmt, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	players := make([]*PlayerView, 0, 8)
	idx := make(map[int]int) // user_id -> index in players slice

	for rows.Next() {
		var (
			userID       int
			userName     string
			userEmail    string
			joinedAt     time.Time
			role         RoomRole
			sheetID      sql.NullInt64
			charName     sql.NullString
			sheetCreated sql.NullTime
			sheetUpdated sql.NullTime
		)

		if err := rows.Scan(
			&userID,
			&userName,
			&userEmail,
			&joinedAt,
			&role,
			&sheetID,
			&charName,
			&sheetCreated,
			&sheetUpdated,
		); err != nil {
			return nil, err
		}

		// get or create player slot preserving order
		pIdx, ok := idx[userID]
		if !ok {
			p := &PlayerView{
				User: User{
					ID:    userID,
					Name:  userName,
					Email: userEmail,
				},
				JoinedAt:        joinedAt,
				Role:            role,
				CharacterSheets: nil,
			}
			players = append(players, p)
			pIdx = len(players) - 1
			idx[userID] = pIdx
		}

		// if a sheet exists in this row, append it
		if sheetID.Valid {
			s := CharacterSheet{
				ID: int(sheetID.Int64),
			}
			if charName.Valid {
				s.CharacterName = charName.String
			}
			if sheetCreated.Valid {
				s.CreatedAt = sheetCreated.Time
			}
			if sheetUpdated.Valid {
				s.UpdatedAt = sheetUpdated.Time
			}
			players[pIdx].CharacterSheets = append(players[pIdx].CharacterSheets, s)
		}
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return players, nil
}
