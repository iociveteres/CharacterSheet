package templates

import (
	"time"

	"charactersheet.iociveteres.net/internal/commands"
	"charactersheet.iociveteres.net/internal/models"
)

type Data struct {
	CurrentYear             int
	CharacterSheet          *models.CharacterSheet
	CharacterSheets         []*models.CharacterSheet
	CharacterSheetSummaries []*models.CharacterSheetSummary
	CharacterSheetContent   *models.CharacterSheetContent
	CanEditSheet            bool
	Room                    *models.Room
	RoomInvite              *models.RoomInvite
	InviteLink              string
	MessagePage             *models.MessagePage
	AvailableCommands       []commands.Command
	Rooms                   []*models.Room
	RoomsWithRole           []*models.RoomWithRole
	PlayerViews             []*models.PlayerView
	CurrentPlayerView       *models.PlayerView
	DicePresets             []models.DicePreset
	Form                    any
	Flash                   string
	IsAuthenticated         bool
	CSRFToken               string
	User                    *models.User
	TimeZone                *time.Location
	HideLayout              bool
	Token                   string
	Nonce                   string
}
