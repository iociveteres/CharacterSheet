package templates

import (
	"encoding/json"
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
	FormerNames             []FormerName            // set only for account.html, the latest first
	DeletionSummary         *models.DeletionSummary // set only for delete_account.html
	DeleteAt                time.Time               // set only for account_deletion.html
	Export                  *ExportPage             // set only for data_export.html
	PendingEmail            string                  // set only for account.html: the new address of a change in progress
	EmailLink               *EmailLinkPage          // set only for email_link.html
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
	// Refresh reloads the page every so many seconds, 0 for never: the export page follows its
	// archive so, without JS.
	Refresh int
}

// ExportPage is the page of the export of the user's data (internal/webapp/data_export.go).
type ExportPage struct {
	// State is that of models.DataExport, "" for no export.
	State string
	// Ahead is how many exports are queued before a queued one.
	Ahead int
	// Size, AvailableUntil and NextAt are of a ready archive: its size as shown, until when it
	// is kept and when a new one may be built, zero for now.
	Size           string
	AvailableUntil time.Time
	NextAt         time.Time
}

// EmailLinkPage is a page of a link of an email change (internal/webapp/email_change.go).
type EmailLinkPage struct {
	Step  string // EmailStep*: whose link it is
	State string // EmailLink*: what the page says
	// Email is the address the link is about: the new one for the links of the change, the one put
	// back for the revert link; "" on an invalid link.
	Email string
}

// The steps and states of EmailLinkPage.
const (
	EmailStepOld    = "old"    // the link to the current address
	EmailStepNew    = "new"    // the link to the new address
	EmailStepRevert = "revert" // the link that puts the old address back

	EmailLinkConfirm = "confirm" // the button, before anything is done
	EmailLinkDone    = "done"
	EmailLinkInvalid = "invalid" // used, expired or never made
	EmailLinkTaken   = "taken"   // the address belongs to another account by now
)

// AuthorEmail is where a user without access to their old mailbox writes to have the email
// changed by hand (plan _prd/account_name_email, decision 8); the privacy policy gives it too.
const AuthorEmail = "iociveteres@gmail.com"

// FormerNamesJSON is FormerNames for account.js, which draws the line anew after a rename.
func (d Data) FormerNamesJSON() (string, error) {
	b, err := json.Marshal(d.FormerNames)
	return string(b), err
}

// FormerName is a former name of the user as shown, its date already worded.
type FormerName struct {
	Name string `json:"name"`
	Date string `json:"date"`
}

// AccountAvatar is the avatar block of the Account page.
type AccountAvatar struct {
	URL     string             // of the saved avatar, "" without one
	Lock    *models.AvatarLock // a moderator's lock that holds, nil without one
	Initial string             // the name's first letter, which stands in for a locked avatar
	Hue     int                // the letter's tint, util.AvatarHue: the same as on the forum
}
