package models

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type RoomMembersInterface interface {
}

type RoomMember struct {
	RoomID   int       `db:"room_id"`
	UserID   int       `db:"user_id"`
	Role     RoomRole  `db:"role"`
	JoinedAt time.Time `db:"joined_at"`
}

type RoomMemberModel struct {
	DB *pgxpool.Pool
}

type RoomRole string

const (
	RoleGamemaster RoomRole = "gamemaster"
	RoleModerator  RoomRole = "moderator"
	RolePlayer     RoomRole = "player"
)

func (r *RoomRole) Scan(src interface{}) error {
	if src == nil {
		*r = ""
		return nil
	}
	switch v := src.(type) {
	case string:
		*r = RoomRole(v)
		return nil
	case []byte:
		*r = RoomRole(string(v))
		return nil
	default:
		return fmt.Errorf("cannot scan %T into RoomRole", src)
	}
}

func (r RoomRole) Value() (driver.Value, error) {
	return string(r), nil
}

// AddOrUpdate adds a room member or updates their role if they already exist.
// It returns the resulting joined_at timestamp.
func (m *RoomMemberModel) AddOrUpdate(ctx context.Context, rm *RoomMember) error {
	const stmt = `
INSERT INTO room_members (room_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (room_id, user_id)
  DO UPDATE SET role = EXCLUDED.role
`
	row := m.DB.QueryRow(ctx, stmt, rm.RoomID, rm.UserID, rm.Role)
	if err := row.Scan(&rm.JoinedAt); err != nil {
		return err
	}
	return nil
}

func (m *RoomMemberModel) Remove(ctx context.Context, roomID, userID int) error {
	const stmt = `
DELETE FROM room_members
WHERE room_id = $1 AND user_id = $2;
`
	ct, err := m.DB.Exec(ctx, stmt, roomID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return errors.New("no such room member")
	}
	return nil
}

func (m *RoomMemberModel) GetRole(ctx context.Context, roomID, userID int) (RoomRole, error) {
	const stmt = `
SELECT role
FROM room_members
WHERE room_id = $1 AND user_id = $2;
`
	var role RoomRole
	row := m.DB.QueryRow(ctx, stmt, roomID, userID)
	if err := row.Scan(&role); err != nil {
		return "", err
	}
	return role, nil
}
