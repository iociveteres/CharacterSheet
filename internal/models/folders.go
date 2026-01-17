package models

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CharacterSheetFolderModelInterface interface {
	Create(ctx context.Context, ownerID, roomID int, name string, visibility SheetVisibility) (*CharacterSheetFolder, error)
	Get(ctx context.Context, folderID int) (*CharacterSheetFolder, error)
	GetForUserInRoom(ctx context.Context, ownerID, roomID int) ([]*CharacterSheetFolder, error)
	Update(ctx context.Context, userID, folderID int, name string, visibility SheetVisibility) error
	Delete(ctx context.Context, userID, folderID int) error
	Reorder(ctx context.Context, userID, roomID int, folderIDs []int) error
	MoveSheetToFolder(ctx context.Context, userID, sheetID int, folderID *int) error
}

type CharacterSheetFolder struct {
	ID         int
	OwnerID    int
	RoomID     int
	Name       string
	Visibility SheetVisibility
	SortOrder  int
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type CharacterSheetFolderModel struct {
	DB *pgxpool.Pool
}

func (m *CharacterSheetFolderModel) Create(ctx context.Context, ownerID, roomID int, name string, visibility SheetVisibility) (*CharacterSheetFolder, error) {
	var maxOrder int
	err := m.DB.QueryRow(ctx, `
		SELECT COALESCE(MAX(sort_order), -1) + 1
		FROM character_sheet_folders
		WHERE owner_id = $1 AND room_id = $2
	`, ownerID, roomID).Scan(&maxOrder)
	if err != nil {
		return nil, err
	}

	stmt := `
		INSERT INTO character_sheet_folders (owner_id, room_id, name, folder_visibility, sort_order, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id, owner_id, room_id, name, folder_visibility, sort_order, created_at, updated_at
	`

	folder := &CharacterSheetFolder{}
	err = m.DB.QueryRow(ctx, stmt, ownerID, roomID, name, visibility, maxOrder).Scan(
		&folder.ID,
		&folder.OwnerID,
		&folder.RoomID,
		&folder.Name,
		&folder.Visibility,
		&folder.SortOrder,
		&folder.CreatedAt,
		&folder.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	return folder, nil
}

func (m *CharacterSheetFolderModel) Get(ctx context.Context, folderID int) (*CharacterSheetFolder, error) {
	stmt := `
		SELECT id, owner_id, room_id, name, folder_visibility, sort_order, created_at, updated_at
		FROM character_sheet_folders
		WHERE id = $1
	`

	folder := &CharacterSheetFolder{}
	err := m.DB.QueryRow(ctx, stmt, folderID).Scan(
		&folder.ID,
		&folder.OwnerID,
		&folder.RoomID,
		&folder.Name,
		&folder.Visibility,
		&folder.SortOrder,
		&folder.CreatedAt,
		&folder.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}

	return folder, nil
}

func (m *CharacterSheetFolderModel) GetForUserInRoom(ctx context.Context, ownerID, roomID int) ([]*CharacterSheetFolder, error) {
	stmt := `
		SELECT id, owner_id, room_id, name, folder_visibility, sort_order, created_at, updated_at
		FROM character_sheet_folders
		WHERE owner_id = $1 AND room_id = $2
		ORDER BY sort_order ASC, id ASC
	`

	rows, err := m.DB.Query(ctx, stmt, ownerID, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	folders := []*CharacterSheetFolder{}
	for rows.Next() {
		folder := &CharacterSheetFolder{}
		err := rows.Scan(
			&folder.ID,
			&folder.OwnerID,
			&folder.RoomID,
			&folder.Name,
			&folder.Visibility,
			&folder.SortOrder,
			&folder.CreatedAt,
			&folder.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		folders = append(folders, folder)
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return folders, nil
}

func (m *CharacterSheetFolderModel) Update(ctx context.Context, userID, folderID int, name string, visibility SheetVisibility) error {
	stmt := `
		UPDATE character_sheet_folders
		SET name = $1, folder_visibility = $2, updated_at = CURRENT_TIMESTAMP
		WHERE id = $3 AND owner_id = $4
	`

	result, err := m.DB.Exec(ctx, stmt, name, visibility, folderID, userID)
	if err != nil {
		return err
	}

	if result.RowsAffected() == 0 {
		return ErrPermissionDenied
	}

	return nil
}

func (m *CharacterSheetFolderModel) Delete(ctx context.Context, userID, folderID int) error {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Move all sheets in this folder to default area
	_, err = tx.Exec(ctx, `
		UPDATE character_sheets
		SET folder_id = NULL
		WHERE folder_id = $1
	`, folderID)
	if err != nil {
		return err
	}

	// Delete the folder
	result, err := tx.Exec(ctx, `
		DELETE FROM character_sheet_folders
		WHERE id = $1 AND owner_id = $2
	`, folderID, userID)
	if err != nil {
		return err
	}

	if result.RowsAffected() == 0 {
		return ErrPermissionDenied
	}

	return tx.Commit(ctx)
}

func (m *CharacterSheetFolderModel) Reorder(ctx context.Context, userID, roomID int, folderIDs []int) error {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Update sort_order for each folder
	stmt := `
		UPDATE character_sheet_folders
		SET sort_order = $1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $2 AND owner_id = $3 AND room_id = $4
	`

	for i, folderID := range folderIDs {
		result, err := tx.Exec(ctx, stmt, i, folderID, userID, roomID)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return ErrPermissionDenied
		}
	}

	return tx.Commit(ctx)
}

func (m *CharacterSheetFolderModel) MoveSheetToFolder(ctx context.Context, userID, sheetID int, folderID *int) error {
	var stmt string
	var result pgconn.CommandTag
	var err error

	if folderID != nil {
		stmt = `
			UPDATE character_sheets cs
			SET folder_id = $1
			WHERE cs.id = $2 
			  AND cs.owner_id = $3
			  AND EXISTS (
				  SELECT 1
				  FROM character_sheet_folders f
				  WHERE f.id = $1
					AND f.owner_id = cs.owner_id
					AND f.room_id = cs.room_id
			  )
		`
		result, err = m.DB.Exec(ctx, stmt, *folderID, sheetID, userID)
	} else {
		// Moving to default area (NULL folder)
		stmt = `
			UPDATE character_sheets
			SET folder_id = NULL
			WHERE id = $1 AND owner_id = $2
		`
		result, err = m.DB.Exec(ctx, stmt, sheetID, userID)
	}

	if err != nil {
		return err
	}

	if result.RowsAffected() == 0 {
		return ErrPermissionDenied
	}

	return nil
}
