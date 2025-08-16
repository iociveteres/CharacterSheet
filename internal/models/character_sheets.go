package models

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CharacterSheetModelInterface interface {
	Insert(ctx context.Context, userId int, content string) (int, error)
	Get(ctx context.Context, id int) (*CharacterSheet, error)
	ByUser(ctx context.Context, userId int) ([]*CharacterSheet, error)
	SummaryByUser(ctx context.Context, ownerId int) ([]*CharacterSheetSummary, error)
}

type CharacterSheet struct {
	ID            int
	OwnerID       int
	RoomID        int
	CharacterName string
	Content       json.RawMessage
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type CharacterSheetModel struct {
	DB *pgxpool.Pool
}

func (m *CharacterSheetModel) Insert(ctx context.Context, userId int, content string) (int, error) {
	stmt := `
INSERT INTO character_sheets (owner_id, content, created_at, updated_at)
VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP))
RETURNING id`

	var id int
	// QueryRow will run the INSERT and scan the returned id
	err := m.DB.QueryRow(ctx, stmt, userId, content).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (m *CharacterSheetModel) Get(ctx context.Context, id int) (*CharacterSheet, error) {
	const stmt = `
	SELECT id, 
		owner_id, 
		content->'character-info'->>'character_name' AS character_name, 
		content, 
		created_at, 
		updated_at
	FROM character_sheets
	WHERE id = $1`

	row := m.DB.QueryRow(ctx, stmt, id)

	s := &CharacterSheet{}
	err := row.Scan(
		&s.ID,
		&s.OwnerID,
		&s.CharacterName,
		&s.Content,
		&s.CreatedAt,
		&s.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}
	return s, nil
}

func (m *CharacterSheetModel) ByUser(ctx context.Context, ownerId int) ([]*CharacterSheet, error) {
	const stmt = `
	SELECT id, 
		owner_id, 
		content->'character-info'->>'character_name' AS character_name, 
		created_at, 
		updated_at
	FROM character_sheets
	WHERE owner_id = $1`

	rows, err := m.DB.Query(ctx, stmt, ownerId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sheets := []*CharacterSheet{}

	for rows.Next() {
		s := &CharacterSheet{}
		if err := rows.Scan(
			&s.ID,
			&s.OwnerID,
			&s.CharacterName,
			&s.CreatedAt,
			&s.UpdatedAt,
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

type CharacterSheetSummary struct {
	CharacterSheet    *CharacterSheet
	RoomName string
}

func (m *CharacterSheetModel) SummaryByUser(ctx context.Context, ownerId int) ([]*CharacterSheetSummary, error) {
	const stmt = `
SELECT
  cs.id,
  cs.owner_id,
  cs.room_id,
  r.name AS room_name,
  cs.content,
  cs.content->'character-info'->>'character_name' AS character_name,
  cs.created_at,
  cs.updated_at
FROM character_sheets AS cs
JOIN rooms AS r ON r.id = cs.room_id
WHERE cs.owner_id = $1
ORDER BY cs.updated_at DESC;`

	rows, err := m.DB.Query(ctx, stmt, ownerId)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var views []*CharacterSheetSummary

	for rows.Next() {
		var (
			id            int
			ownerID       int
			roomID        int
			roomName      string
			contentBytes  []byte
			characterName string
			createdAt     time.Time
			updatedAt     time.Time
		)

		if err := rows.Scan(
			&id,
			&ownerID,
			&roomID,
			&roomName,
			&contentBytes,
			&characterName,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, err
		}

		sheet := &CharacterSheet{
			ID:            id,
			OwnerID:       ownerID,
			RoomID:        roomID,
			CharacterName: characterName,
			Content:       json.RawMessage(contentBytes),
			CreatedAt:     createdAt,
			UpdatedAt:     updatedAt,
		}

		views = append(views, &CharacterSheetSummary{
			CharacterSheet:    sheet,
			RoomName: roomName,
		})
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return views, nil
}
