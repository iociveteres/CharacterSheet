package models

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RoomMessagesModelInterface interface {
	Create(ctx context.Context, userID, roomID int, messageBody string, commandResult *string) (int, time.Time, error)
	Get(ctx context.Context, id int) (*Message, error)

	// DTO
	// is this even ok? it's convenient
	CreateWithUsername(ctx context.Context, userID, roomID int, messageBody string, commandResult *string) (MessageWithName, error)
	// GetPage returns messages for a room using offset pagination: from..to (inclusive)
	// The returned messages are ordered from newest -> oldest
	// The maximum number of messages returned is 50 (clamped)
	GetMessagePage(ctx context.Context, roomID, from, to int) (*MessagePage, error)
}

type Message struct {
	ID            int       `json:"id"`
	RoomID        int       `json:"roomId"`
	UserID        int       `json:"userId"`
	MessageBody   string    `json:"messageBody"`
	CommandResult *string   `json:"commandResult,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}

type MessageWithName struct {
	Message  Message `json:"message"`
	Username string  `json:"username"`
}

type MessagePage struct {
	Messages []MessageWithName `json:"messages"`
	HasMore  bool              `json:"hasMore"`
	From     int               `json:"from"`
	To       int               `json:"to"`
}

type RoomMessagesModel struct {
	DB *pgxpool.Pool
}

func (m Message) MarshalJSON() ([]byte, error) {
	type Alias Message
	return json.Marshal(&struct {
		CreatedAt string `json:"createdAt"`
		*Alias
	}{
		CreatedAt: m.CreatedAt.Format(time.RFC3339),
		Alias:     (*Alias)(&m),
	})
}

func (m *RoomMessagesModel) Create(ctx context.Context, userID, roomID int, messageBody string, commandResult *string) (int, time.Time, error) {
	const stmt = `
INSERT INTO room_messages (room_id, user_id, message_body, command_result)
VALUES ($1, $2, $3, $4)
RETURNING id, created_at;
`

	var cmd sql.NullString
	if commandResult != nil {
		cmd = sql.NullString{String: *commandResult, Valid: true}
	}

	row := m.DB.QueryRow(ctx, stmt, roomID, userID, messageBody, cmd)

	var id int64
	var createdAt time.Time
	if err := row.Scan(&id, &createdAt); err != nil {
		return 0, time.Time{}, err
	}

	return int(id), createdAt, nil
}

func (m *RoomMessagesModel) CreateWithUsername(ctx context.Context, userID, roomID int, messageBody string, commandResult *string) (MessageWithName, error) {
	const stmt = `
WITH inserted AS (
    INSERT INTO room_messages (room_id, user_id, message_body, command_result)
    VALUES ($1, $2, $3, $4)
    RETURNING id, room_id, user_id, message_body, command_result, created_at
)
SELECT i.id, i.room_id, i.user_id, i.message_body, i.command_result, i.created_at, u.name
FROM inserted i
JOIN users u ON u.id = i.user_id;
`

	row := m.DB.QueryRow(ctx, stmt, roomID, userID, messageBody, commandResult)

	var (
		id                int64
		roomIDOut         int
		userIDOut         int
		body              string
		createdAt         time.Time
		username          string
		commandResultNull sql.NullString
	)

	if err := row.Scan(&id, &roomIDOut, &userIDOut, &body, &commandResultNull, &createdAt, &username); err != nil {
		return MessageWithName{}, err
	}

	var cmdResult *string
	if commandResultNull.Valid {
		s := commandResultNull.String
		cmdResult = &s
	} else {
		cmdResult = nil
	}

	msg := Message{
		ID:            int(id),
		RoomID:        roomIDOut,
		UserID:        userIDOut,
		MessageBody:   body,
		CommandResult: cmdResult,
		CreatedAt:     createdAt,
	}

	return MessageWithName{
		Message:  msg,
		Username: username,
	}, nil
}

func (m *RoomMessagesModel) Get(ctx context.Context, id int) (*Message, error) {
	const stmt = `
SELECT id, room_id, user_id, message_body, created_at
FROM room_messages
WHERE id = $1;
`

	row := m.DB.QueryRow(ctx, stmt, id)

	msg := &Message{}
	if err := row.Scan(
		&msg.ID,
		&msg.RoomID,
		&msg.UserID,
		&msg.MessageBody,
		&msg.CreatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}

	return msg, nil
}

// GetPage returns messages for a room between offsets `from` and `to` (inclusive)
func (m *RoomMessagesModel) GetMessagePage(ctx context.Context, roomID, from, to int) (*MessagePage, error) {
	page := MessagePage{
		Messages: []MessageWithName{},
		HasMore:  false,
		From:     from,
		To:       to,
	}

	limit := to - from + 1
	if limit <= 0 {
		return &page, nil
	}
	if limit > 50 {
		limit = 50
	}
	limitPlusOne := limit + 1

	const stmt = `
SELECT m.id, m.room_id, m.user_id, m.message_body, m.command_result, m.created_at, u.name
FROM room_messages m
JOIN users u ON u.id = m.user_id
WHERE m.room_id = $1
ORDER BY m.created_at ASC
OFFSET $2
LIMIT $3;
`

	rows, err := m.DB.Query(ctx, stmt, roomID, from, limitPlusOne)
	if err != nil {
		return &page, err
	}
	defer rows.Close()

	results := make([]MessageWithName, 0, limitPlusOne)
	for rows.Next() {
		var (
			id        int64
			roomIDOut int
			userIDOut int
			body      string
			cmd       sql.NullString
			createdAt time.Time
			username  string
		)
		if err := rows.Scan(&id, &roomIDOut, &userIDOut, &body, &cmd, &createdAt, &username); err != nil {
			return &page, err
		}

		var commandResult *string
		if cmd.Valid {
			p := new(string)
			*p = cmd.String
			commandResult = p
		}

		msg := Message{
			ID:            int(id),
			RoomID:        roomIDOut,
			UserID:        userIDOut,
			MessageBody:   body,
			CommandResult: commandResult,
			CreatedAt:     createdAt,
		}

		results = append(results, MessageWithName{
			Message:  msg,
			Username: username,
		})
	}
	if err := rows.Err(); err != nil {
		return &page, err
	}

	if len(results) > limit {
		page.HasMore = true
		results = results[:limit]
	}

	page.Messages = results
	return &page, nil
}
