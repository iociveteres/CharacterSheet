package models

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DicePreset struct {
	ID           int       `json:"id"`
	RoomID       int       `json:"roomId"`
	UserID       int       `json:"userId"`
	SlotNumber   int       `json:"slotNumber"`
	DiceNotation string    `json:"diceNotation"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type RoomDicePresetsModelInterface interface {
	Upsert(ctx context.Context, userID, roomID, slotNumber int, notation string) error
	GetForUser(ctx context.Context, userID, roomID int) ([]DicePreset, error)
}

type RoomDicePresetsModel struct {
	DB *pgxpool.Pool
}

func (m *RoomDicePresetsModel) Upsert(ctx context.Context, userID, roomID, slotNumber int, notation string) error {
	const stmt = `
INSERT INTO dice_presets (room_id, user_id, slot_number, dice_notation, updated_at)
VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
ON CONFLICT (room_id, user_id, slot_number)
DO UPDATE SET 
    dice_notation = EXCLUDED.dice_notation,
    updated_at = CURRENT_TIMESTAMP;
`
	_, err := m.DB.Exec(ctx, stmt, roomID, userID, slotNumber, notation)
	return err
}

func (m *RoomDicePresetsModel) GetForUser(ctx context.Context, userID, roomID int) ([]DicePreset, error) {
	const stmt = `
SELECT id, room_id, user_id, slot_number, dice_notation, updated_at
FROM dice_presets
WHERE user_id = $1 AND room_id = $2
ORDER BY slot_number;
`
	rows, err := m.DB.Query(ctx, stmt, userID, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	presets := make([]DicePreset, 0, 5)
	for rows.Next() {
		var p DicePreset
		if err := rows.Scan(&p.ID, &p.RoomID, &p.UserID, &p.SlotNumber, &p.DiceNotation, &p.UpdatedAt); err != nil {
			return nil, err
		}
		presets = append(presets, p)
	}

	return presets, rows.Err()
}
