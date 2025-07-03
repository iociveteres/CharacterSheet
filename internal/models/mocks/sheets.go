package mocks

import (
	"context"
	"time"

	"charactersheet.iociveteres.net/internal/models"
)

var mockSheet = &models.Sheet{
	ID:      1,
	Title:   "An old silent pond",
	Content: "An old silent pond...",
	Created: time.Now(),
	Expires: time.Now(),
}

type SheetModel struct{}

func (m *SheetModel) Insert(ctx context.Context, title string, content string, expires int) (int, error) {
	return 2, nil
}
func (m *SheetModel) Get(ctx context.Context, id int) (*models.Sheet, error) {
	switch id {
	case 1:
		return mockSheet, nil
	default:
		return nil, models.ErrNoRecord
	}
}
func (m *SheetModel) Latest(ctx context.Context) ([]*models.Sheet, error) {
	return []*models.Sheet{mockSheet}, nil
}
