package models

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RoomInvitesInterface interface {
	CreateOrReplaceInvite(ctx context.Context, roomID int, expiresAt *time.Time, maxUses *int) (*RoomInvite, error)
	TryEnterRoom(ctx context.Context, token uuid.UUID, userID int, role RoomRole) (int, bool, error)
	GetInvite(ctx context.Context, roomID int) (*RoomInvite, error)
}

type RoomInvite struct {
	RoomID    int
	Token     string // UUID as string
	CreatedAt time.Time
	ExpiresAt *time.Time // NULL => nil
	MaxUses   *int       // NULL => nil (unlimited)
	Uses      int
}

type RoomInviteModel struct {
	DB *pgxpool.Pool
}

// CreateOrReplaceInvite creates a new invite for roomID or replaces the existing one.
// expiresAt and maxUses may be nil.
func (m *RoomInviteModel) CreateOrReplaceInvite(ctx context.Context, roomID int, expiresAt *time.Time, maxUses *int) (*RoomInvite, error) {
	const stmt = `
INSERT INTO room_invites (room_id, token, created_at, expires_at, max_uses, uses)
VALUES ($1, $2, now(), $3, $4, 0)
ON CONFLICT (room_id) DO UPDATE
SET token = EXCLUDED.token,
    created_at = now(),
    expires_at = EXCLUDED.expires_at,
    max_uses = EXCLUDED.max_uses,
    uses = 0
RETURNING room_id, token, created_at, expires_at, max_uses, uses;
`

	newToken := uuid.New()

	row := m.DB.QueryRow(ctx, stmt, roomID, newToken, expiresAt, maxUses)

	invite := &RoomInvite{}
	err := row.Scan(
		&invite.RoomID,
		&invite.Token,
		&invite.CreatedAt,
		&invite.ExpiresAt,
		&invite.MaxUses,
		&invite.Uses,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}

	return invite, nil
}

// TryEnterRoom tries to redeem the invite token and add the user to the room.
// Returns the room ID and a boolean `created` which is true when a new membership
// was inserted, false when the user was already a member
func (m *RoomInviteModel) TryEnterRoom(ctx context.Context, token uuid.UUID, userID int, role RoomRole) (int, bool, error) {
	const stmt = `
SELECT rid, created
FROM redeem_and_add_member($1, $2, $3);
`
	var roomID int
	var created bool
	row := m.DB.QueryRow(ctx, stmt, token, userID, role)

	if err := row.Scan(&roomID, &created); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, false, ErrLinkInvalid
		}
		return 0, false, err
	}

	return roomID, created, nil
}

func (m *RoomInviteModel) GetInvite(ctx context.Context, roomID int) (*RoomInvite, error) {
	const stmt = `
	SELECT room_id, token, created_at, expires_at, max_uses, uses
	FROM room_invites
	WHERE room_id = $1;
	`

	row := m.DB.QueryRow(ctx, stmt, roomID)

	invite := &RoomInvite{}
	err := row.Scan(
		&invite.RoomID,
		&invite.Token,
		&invite.CreatedAt,
		&invite.ExpiresAt,
		&invite.MaxUses,
		&invite.Uses,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	return invite, nil
}
