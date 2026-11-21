package templates

import (
	"html/template"
	"time"

	"charactersheet.iociveteres.net/internal/commands"
	"charactersheet.iociveteres.net/internal/models"
)

type Data struct {
	Lang                    string // one of i18n.Languages
	RequestURI              string // where the language switcher brings back
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
	Encounters              *models.EncounterList
	InitiativeView          *models.InitiativeView
	DicePresets             []models.DicePreset
	Form                    any
	Flash                   string
	IsAuthenticated         bool
	CSRFToken               string
	User                    *models.User
	TimeZone                *time.Location
	HideLayout              bool
	ShowIncidentNotice      bool
	Token                   string
	OnlineUsers             int
	Embedded                *EmbeddedPage           // set only for embedded.html
	Avatar                  *AccountAvatar          // set only for account.html
	DeletionSummary         *models.DeletionSummary // set only for delete_account.html
	DeleteAt                time.Time               // set only for account_deletion.html
	Head                    *PageHead               // what a site page adds to base.html's head; nil for most
	// ForumBadge counts the unread forum notifications of the signed-in user as the nav shows them
	// ("3", "9+", empty for none); nil for a guest. It is called only by the nav, so a page drawn
	// without it (a room) never asks the forum.
	ForumBadge func() string
}

// NavForumBadge is ForumBadge for the nav template, which cannot call a nil func.
func (d Data) NavForumBadge() string {
	if d.ForumBadge == nil {
		return ""
	}
	return d.ForumBadge()
}

// EmbeddedPage is a page rendered elsewhere (the forum) and shown inside the site layout.
// Unlike the site pages it asks for a viewport: it is laid out for phones.
type EmbeddedPage struct {
	Title, Description, Canonical string
	NoIndex                       bool
	// Styles and Scripts are paths under /static, after the site's own.
	Styles, Scripts []string
	// MainClass is added to the class of <main>: a page may be laid out wider than the site.
	MainClass string
	Body      template.HTML
}

// PageHead is what a site page asks base.html for beyond the site's own head, as EmbeddedPage
// does for an embedded one.
type PageHead struct {
	// Viewport is for a page laid out for phones: without it a phone draws the page about 980px
	// wide (_prd/forum/plan.md, amendment 5).
	Viewport bool
	// Styles and Scripts are paths under /static, after the site's own.
	Styles, Scripts []string
}

// AccountAvatar is the avatar block of the Account page.
type AccountAvatar struct {
	URL     string             // of the saved avatar, "" without one
	Lock    *models.AvatarLock // a moderator's lock that holds, nil without one
	Initial string             // the name's first letter, which stands in for a locked avatar
	Hue     int                // the letter's tint, util.AvatarHue: the same as on the forum
}
