package models

import (
	"github.com/jackc/pgx/v5/pgxpool"
)

type Models struct {
	Users           UserModelInterface
	CharacterSheets CharacterSheetModelInterface
	Rooms           RoomModelInterface
	RoomInvites     RoomInvitesInterface
}

func NewModels(db *pgxpool.Pool) Models {
	return Models{
		Users:           &UserModel{DB: db},
		CharacterSheets: &CharacterSheetModel{DB: db},
		Rooms:           &RoomModel{DB: db},
		RoomInvites:     &RoomInviteModel{DB: db},
	}
}
