package mocks

import (
	"context"
	"time"

	"charactersheet.iociveteres.net/internal/models"
	"github.com/google/uuid"
)

// The rest of what the room page reads: room 1 has no invite, presets or messages.

type RoomInviteModel struct{}

func (m *RoomInviteModel) CreateOrReplaceInvite(ctx context.Context, roomID int, expiresAt *time.Time, maxUses *int) (*models.RoomInvite, error) {
	return nil, nil
}
func (m *RoomInviteModel) TryEnterRoom(ctx context.Context, token uuid.UUID, userID int, role models.RoomRole) (int, bool, error) {
	return 0, false, models.ErrLinkInvalid
}
func (m *RoomInviteModel) GetInvite(ctx context.Context, roomID int) (*models.RoomInvite, error) {
	return nil, nil
}

type RoomDicePresetsModel struct{}

func (m *RoomDicePresetsModel) Upsert(ctx context.Context, userID, roomID, slotNumber int, notation string) error {
	return nil
}
func (m *RoomDicePresetsModel) GetForUser(ctx context.Context, userID, roomID int) ([]models.DicePreset, error) {
	return nil, nil
}

type RoomMessagesModel struct{}

func (m *RoomMessagesModel) Create(ctx context.Context, userID, roomID int, messageBody string, commandResult, characterName *string) (int, time.Time, error) {
	return 1, time.Now(), nil
}
func (m *RoomMessagesModel) Get(ctx context.Context, id int) (*models.Message, error) {
	return nil, models.ErrNoRecord
}
func (m *RoomMessagesModel) Remove(ctx context.Context, callerID, roomID, messageID int) error {
	return nil
}
func (m *RoomMessagesModel) CreateWithUsername(ctx context.Context, userID, roomID int, messageBody string, commandResult, characterName *string) (models.MessageWithName, error) {
	return models.MessageWithName{}, nil
}
func (m *RoomMessagesModel) GetMessagePage(ctx context.Context, roomID int, offset int, limit int) (*models.MessagePage, error) {
	return &models.MessagePage{}, nil
}
