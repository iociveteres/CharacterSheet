package models

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CharacterSheetModelInterface interface {
	Insert(ctx context.Context, userID, RoomID int) (int, error)
	InsertWithContent(ctx context.Context, userID, roomID int, content json.RawMessage) (int, error)
	Delete(ctx context.Context, userID, sheetID int) (int, error)
	ChangeVisibility(ctx context.Context, userID, sheetID int, visibility string) (int, error)
	Get(ctx context.Context, id int) (*CharacterSheet, error)
	ByUser(ctx context.Context, userID int) ([]*CharacterSheet, error)

	// JSON
	CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos json.RawMessage, init json.RawMessage) (int, error)
	ChangeField(ctx context.Context, userID, sheetID int, path []string, newValueJSON []byte) (int, error)
	ApplyBatch(ctx context.Context, userID, sheetID int, path []string, changes []byte) (int, error)
	DeleteItem(ctx context.Context, userID, sheetID int, path []string) (int, error)
	ReplacePositions(ctx context.Context, userID, sheetID int, path []string, positions map[string]Position) (int, error)
	MoveItemBetweenGrids(ctx context.Context, userID, sheetID int, fromPath, toPath []string, itemID string, toPos json.RawMessage) (int, error)

	// DTO
	SummaryByUser(ctx context.Context, ownerID int) ([]*CharacterSheetSummary, error)
	GetWithPermission(ctx context.Context, userID, sheetID int) (*CharacterSheetView, error)
}

type SheetVisibility string

const (
	VisibilityEveryoneCanEdit SheetVisibility = "everyone_can_edit"
	VisibilityEveryoneCanView SheetVisibility = "everyone_can_view"
	VisibilityEveryoneCanSee  SheetVisibility = "everyone_can_see"
	VisibilityHideFromPlayers SheetVisibility = "hide_from_players"
)

func (v SheetVisibility) IsValid() bool {
	switch v {
	case
		VisibilityEveryoneCanEdit,
		VisibilityEveryoneCanView,
		VisibilityEveryoneCanSee,
		VisibilityHideFromPlayers:
		return true
	default:
		return false
	}
}

func (v *SheetVisibility) Scan(src any) error {
	var s string

	switch x := src.(type) {
	case string:
		s = x
	case []byte:
		s = string(x)
	default:
		return fmt.Errorf("cannot scan %T into SheetVisibility", src)
	}

	val := SheetVisibility(s)
	if !val.IsValid() {
		return fmt.Errorf("invalid SheetVisibility value: %q", s)
	}

	*v = val
	return nil
}

func (v SheetVisibility) Value() (driver.Value, error) {
	if !v.IsValid() {
		return nil, fmt.Errorf("invalid SheetVisibility value: %q", v)
	}
	return string(v), nil
}

type CharacterSheet struct {
	ID            int
	OwnerID       int
	RoomID        int
	CharacterName string
	Content       json.RawMessage
	Visibility    SheetVisibility
	FolderID      *int
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type CharacterSheetModel struct {
	DB *pgxpool.Pool
}

func (m *CharacterSheetModel) Insert(ctx context.Context, userID, roomID int) (int, error) {
	stmt := `
INSERT INTO character_sheets (owner_id, room_id, content, created_at, updated_at)
VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id`

	var id int
	// QueryRow will run the INSERT and scan the returned id
	err := m.DB.QueryRow(ctx, stmt, userID, roomID, defaultContent).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

// InsertWithContent creates a new character sheet with provided JSON content
func (m *CharacterSheetModel) InsertWithContent(ctx context.Context, userID, roomID int, content json.RawMessage) (int, error) {
	stmt := `
INSERT INTO character_sheets (owner_id, room_id, content, created_at, updated_at)
VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id`

	var id int
	err := m.DB.QueryRow(ctx, stmt, userID, roomID, content).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (m *CharacterSheetModel) Delete(ctx context.Context, userID, sheetID int) (int, error) {
	stmt := `
        DELETE FROM character_sheets
        WHERE id = $1
          AND can_edit_character_sheet($2, $1)
        RETURNING id
    `
	var id int
	err := m.DB.QueryRow(ctx, stmt, sheetID, userID).Scan(&id)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (m *CharacterSheetModel) Get(ctx context.Context, id int) (*CharacterSheet, error) {
	const stmt = `
	SELECT id, 
		owner_id,
		room_id,
		content->'characterInfo'->>'characterName' AS character_name, 
		content,
		sheet_visibility,
		folder_id,
		created_at, 
		updated_at
	FROM character_sheets
	WHERE id = $1`

	row := m.DB.QueryRow(ctx, stmt, id)

	s := &CharacterSheet{}
	err := row.Scan(
		&s.ID,
		&s.OwnerID,
		&s.RoomID,
		&s.CharacterName,
		&s.Content,
		&s.Visibility,
		&s.FolderID,
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

func (m *CharacterSheetModel) ChangeVisibility(ctx context.Context, userID, sheetID int, visibility string) (int, error) {
	const stmt = `
        UPDATE character_sheets
        SET sheet_visibility = $1::sheet_visibility,
            version = version + 1,
            updated_at = now()
        WHERE id = $2
          AND owner_id = $3
        RETURNING version
    `
	var version int
	err := m.DB.QueryRow(ctx, stmt, visibility, sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

func (m *CharacterSheetModel) ByUser(ctx context.Context, ownerID int) ([]*CharacterSheet, error) {
	const stmt = `
	SELECT id, 
		owner_id, 
		content->'characterInfo'->>'characterName' AS character_name, 
		created_at, 
		updated_at
	FROM character_sheets
	WHERE owner_id = $1`

	rows, err := m.DB.Query(ctx, stmt, ownerID)
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
	CharacterSheet *CharacterSheet
	RoomName       string
}

func (m *CharacterSheetModel) SummaryByUser(ctx context.Context, ownerID int) ([]*CharacterSheetSummary, error) {
	const stmt = `
SELECT
  cs.id,
  cs.owner_id,
  cs.room_id,
  r.name AS room_name,
  cs.content,
  cs.content->'characterInfo'->>'characterName' AS character_name,
  cs.created_at,
  cs.updated_at
FROM character_sheets AS cs
JOIN rooms AS r ON r.id = cs.room_id
WHERE cs.owner_id = $1
ORDER BY cs.updated_at DESC;`

	rows, err := m.DB.Query(ctx, stmt, ownerID)
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
			CharacterSheet: sheet,
			RoomName:       roomName,
		})
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return views, nil
}

func replaceLastSegment(path []string, from, to string) ([]string, error) {
	result := make([]string, len(path))
	copy(result, path)

	found := false
	for i := len(result) - 1; i >= 0; i-- {
		if result[i] == from {
			result[i] = to
			found = true
			break
		}
	}

	if !found {
		return nil, fmt.Errorf("segment '%s' not found in path", from)
	}

	return result, nil
}

func (m *CharacterSheet) UnmarshalContent() (*CharacterSheetContent, error) {
	if len(m.Content) == 0 {
		return nil, ErrNoContent
	}

	var content CharacterSheetContent
	if err := json.Unmarshal(m.Content, &content); err != nil {
		return nil, err
	}

	return &content, nil
}

// DTO for view with permission info
type CharacterSheetView struct {
	CharacterSheet *CharacterSheet
	CanEdit        bool
	CanView        bool
}

func (m *CharacterSheetModel) GetWithPermission(ctx context.Context, userID, sheetID int) (*CharacterSheetView, error) {
	const stmt = `
        SELECT 
            cs.id,
            cs.owner_id,
            cs.content->'characterInfo'->>'characterName' AS character_name,
            cs.content,
            cs.created_at,
            cs.updated_at,
            cs.sheet_visibility,
            cs.folder_id,
			can_view_character_sheet($1, cs.id) AS can_view,
            can_edit_character_sheet($1, cs.id) AS can_edit
        FROM character_sheets cs
        WHERE cs.id = $2
    `

	row := m.DB.QueryRow(ctx, stmt, userID, sheetID)

	s := &CharacterSheet{}
	var canView, canEdit bool

	err := row.Scan(
		&s.ID,
		&s.OwnerID,
		&s.CharacterName,
		&s.Content,
		&s.CreatedAt,
		&s.UpdatedAt,
		&s.Visibility,
		&s.FolderID,
		&canView,
		&canEdit,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}

	// Check if user has view permission
	if !canView {
		return nil, ErrPermissionDenied
	}

	return &CharacterSheetView{
		CharacterSheet: s,
		CanView:        canView,
		CanEdit:        canEdit,
	}, nil
}
