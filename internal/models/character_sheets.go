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
	GetAllForUser(ctx context.Context, userId int) ([]*CharacterSheet, error)
}

type CharacterSheet struct {
	ID            int
	OwnerID        int
	CharacterName string
	Content       json.RawMessage
	Created       time.Time
	Updated       time.Time
}

type CharacterSheetModel struct {
	DB *pgxpool.Pool
}

func (m *CharacterSheetModel) Insert(ctx context.Context, userId int, content string) (int, error) {
	stmt := `
INSERT INTO character_sheets (owner_id, content, created, updated)
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
		created, 
		updated
	FROM character_sheets
	WHERE id = $1`

	row := m.DB.QueryRow(ctx, stmt, id)

	s := &CharacterSheet{}
	err := row.Scan(
		&s.ID,
		&s.OwnerID,
		&s.CharacterName,
		&s.Content,
		&s.Created,
		&s.Updated,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}
	return s, nil
}

func (m *CharacterSheetModel) GetAllForUser(ctx context.Context, ownerId int) ([]*CharacterSheet, error) {
	const stmt = `
	SELECT id, 
		owner_id, 
		content->'character-info'->>'character_name' AS character_name, 
		content, 
		created, 
		updated
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
			&s.Content,
			&s.Created,
			&s.Updated,
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
