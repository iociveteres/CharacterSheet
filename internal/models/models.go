package models

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Models struct {
	Users                 UserModelInterface
	CharacterSheets       CharacterSheetModelInterface
	CharacterSheetFolders CharacterSheetFolderModelInterface
	Rooms                 RoomModelInterface
	RoomMembers           RoomMembersInterface
	RoomInvites           RoomInvitesInterface
	RoomMessages          RoomMessagesModelInterface
	RoomDicePresets       RoomDicePresetsModelInterface
	Tokens                TokenModelInterface
	db                    *pgxpool.Pool
}

func NewModels(db *pgxpool.Pool) Models {
	return Models{
		Users:                 &UserModel{DB: db},
		CharacterSheets:       &CharacterSheetModel{DB: db},
		CharacterSheetFolders: &CharacterSheetFolderModel{DB: db},
		Rooms:                 &RoomModel{DB: db},
		RoomMembers:           &RoomMembersModel{DB: db},
		RoomInvites:           &RoomInviteModel{DB: db},
		RoomMessages:          &RoomMessagesModel{DB: db},
		RoomDicePresets:       &RoomDicePresetsModel{DB: db},
		Tokens:                &TokenModel{DB: db},
	}
}

func (m Models) CheckHealth(ctx context.Context) error {
	return m.db.Ping(ctx)
}
