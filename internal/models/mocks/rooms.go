package mocks

import (
	"context"

	"charactersheet.iociveteres.net/internal/models"
)

// RoomModel has one room, 1, with one member: user 1.
type RoomModel struct{}

func (m *RoomModel) Create(ctx context.Context, userId int, content string) (int, error) {
	return 2, nil
}

func (m *RoomModel) Get(ctx context.Context, id int) (*models.Room, error) {
	if id != 1 {
		return nil, models.ErrNoRecord
	}
	return &models.Room{ID: 1, OwnerID: 1, Name: "Mock room"}, nil
}

func (m *RoomModel) Remove(ctx context.Context, roomID int, requestingUserID int) error {
	return nil
}

func (m *RoomModel) ByUser(ctx context.Context, userId int) ([]*models.Room, error) {
	return nil, nil
}

func (m *RoomModel) ByUserWithRole(ctx context.Context, userID int) ([]*models.RoomWithRole, error) {
	return nil, nil
}

func (m *RoomModel) HasUser(ctx context.Context, roomID int, userID int) (bool, error) {
	return roomID == 1 && userID == 1, nil
}

func (m *RoomModel) PlayersWithSheets(ctx context.Context, roomID int) ([]*models.PlayerView, error) {
	return nil, nil
}
