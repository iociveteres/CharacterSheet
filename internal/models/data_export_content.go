package models

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"charactersheet.iociveteres.net/internal/forum"
	"github.com/jackc/pgx/v5"
)

// What goes into the archive of a user's data (plan _prd/account_deletion, section 6.3): only
// the user's own. The readers of what may be large (sheets, chat, posts) call a func with each
// row as it comes from the database, so that the archive is written while it is read and none
// of it is held whole: the server has 1 GB. The JSON names are those of the archive's files.

type ExportContentInterface interface {
	Account(ctx context.Context, userID int) (*ExportAccount, error)
	Avatar(ctx context.Context, userID int) (*Avatar, error)
	Rooms(ctx context.Context, userID int) ([]ExportRoom, error)
	Sheets(ctx context.Context, userID int, fn func(ExportSheet) error) error
	Collections(ctx context.Context, userID int) ([]ExportCollection, error)
	PortraitHashes(ctx context.Context, userID int) ([]string, error)
	Portrait(ctx context.Context, hash string) (*Portrait, error)
	ChatMessages(ctx context.Context, userID int, fn func(ExportMessage) error) error
	ForumTopics(ctx context.Context, userID int, fn func(forum.ExportTopic) error) error
	ForumPosts(ctx context.Context, userID int, fn func(forum.ExportPost) error) error
	ForumProfile(ctx context.Context, userID int) (*forum.ExportProfile, error)
	Moderation(ctx context.Context, userID int) (*ExportModeration, error)
}

type ExportAccount struct {
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"createdAt"`
	// Locale is the language the user picked, "" for none.
	Locale string `json:"locale"`
	// FormerNames are all of them, newest first; the pages show only the last few.
	FormerNames []NameChange `json:"formerNames"`
}

// Account leaves out an email change not yet confirmed (plan _prd/account_name_email, section 7):
// it is a token, not data of the account.
func (m *DataExportModel) Account(ctx context.Context, userID int) (*ExportAccount, error) {
	a := &ExportAccount{}
	err := m.DB.QueryRow(ctx, `SELECT name, email, created_at, COALESCE(locale, '') FROM users WHERE id = $1`, userID).
		Scan(&a.Name, &a.Email, &a.CreatedAt, &a.Locale)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	if err != nil {
		return nil, err
	}
	a.FormerNames, err = (&UserModel{DB: m.DB}).NameHistory(ctx, userID, 0)
	return a, err
}

// Avatar is the user's avatar, ErrNoRecord without one.
func (m *DataExportModel) Avatar(ctx context.Context, userID int) (*Avatar, error) {
	a := &Avatar{}
	err := m.DB.QueryRow(ctx, `SELECT mime, data FROM user_avatars WHERE user_id = $1`, userID).Scan(&a.Mime, &a.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	return a, err
}

// ExportRoom is a room the user is in or created.
type ExportRoom struct {
	Name string `json:"name"`
	// Role and JoinedAt are empty in a room the user created and left.
	Role        *RoomRole          `json:"role"`
	JoinedAt    *time.Time         `json:"joinedAt"`
	Owner       bool               `json:"owner"`
	DicePresets []ExportDicePreset `json:"dicePresets"`
}

type ExportDicePreset struct {
	Slot     int    `json:"slot"`
	Notation string `json:"notation"`
}

func (m *DataExportModel) Rooms(ctx context.Context, userID int) ([]ExportRoom, error) {
	rows, err := m.DB.Query(ctx, `
SELECT r.name, rm.role, rm.joined_at, r.owner_id = $1,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('slot', d.slot_number, 'notation', d.dice_notation) ORDER BY d.slot_number)
              FROM dice_presets d WHERE d.room_id = r.id AND d.user_id = $1), '[]')
FROM rooms r
LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $1
WHERE rm.user_id IS NOT NULL OR r.owner_id = $1
ORDER BY r.id`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ExportRoom, error) {
		var r ExportRoom
		var presets []byte
		if err := row.Scan(&r.Name, &r.Role, &r.JoinedAt, &r.Owner, &presets); err != nil {
			return r, err
		}
		return r, json.Unmarshal(presets, &r.DicePresets)
	})
}

// ExportSheet is a sheet of the user in a room, or an NPC of theirs in a scene of one; a
// creature of the bestiary goes with its collection.
type ExportSheet struct {
	ID            int
	Room          string
	NPC           bool
	CharacterName string
	Kind          SheetKind
	Content       json.RawMessage
	// Author is as in the export of one sheet (CharacterSheetModel.ExportAuthor).
	Author *string
}

// Sheets calls fn with each sheet and NPC of the user, by room. The scenes themselves stay out
// (decision 24): other gamemasters of the room made them too.
func (m *DataExportModel) Sheets(ctx context.Context, userID int, fn func(ExportSheet) error) error {
	rows, err := m.DB.Query(ctx, `
SELECT cs.id, r.name, cs.encounter_id IS NOT NULL, cs.character_name, cs.sheet_kind, cs.content,
    CASE WHEN cs.room_id IS NOT NULL THEN (SELECT name FROM users WHERE id = cs.owner_id) ELSE `+authorName+` END
FROM character_sheets cs
LEFT JOIN encounters e ON e.id = cs.encounter_id
JOIN rooms r ON r.id = COALESCE(cs.room_id, e.room_id)
WHERE cs.owner_id = $1 AND cs.collection_id IS NULL
ORDER BY r.id, cs.encounter_id NULLS FIRST, cs.id`, userID)
	if err != nil {
		return err
	}
	var s ExportSheet
	_, err = pgx.ForEachRow(rows, []any{&s.ID, &s.Room, &s.NPC, &s.CharacterName, &s.Kind, &s.Content, &s.Author}, func() error {
		return fn(s)
	})
	return err
}

// ExportCollection is a bestiary collection of the user; its file is BestiaryModel.Export.
type ExportCollection struct {
	ID   int
	Name string
}

func (m *DataExportModel) Collections(ctx context.Context, userID int) ([]ExportCollection, error) {
	rows, err := m.DB.Query(ctx, `SELECT id, name FROM bestiary_collections WHERE owner_id = $1 ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[ExportCollection])
}

// PortraitHashes are the portraits of the user's sheets, NPCs and creatures.
func (m *DataExportModel) PortraitHashes(ctx context.Context, userID int) ([]string, error) {
	rows, err := m.DB.Query(ctx, `
SELECT DISTINCT sp.hash FROM sheet_portraits sp JOIN character_sheets cs ON cs.id = sp.sheet_id
WHERE cs.owner_id = $1 ORDER BY sp.hash`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// Portrait is the image of a hash PortraitHashes gave, ErrNoRecord when it is gone since.
func (m *DataExportModel) Portrait(ctx context.Context, hash string) (*Portrait, error) {
	p := &Portrait{}
	err := m.DB.QueryRow(ctx, `SELECT mime, data FROM portrait_images WHERE hash = $1`, hash).Scan(&p.Mime, &p.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	return p, err
}

// ExportMessage is a chat message of the user. Label is the code of a roll's label
// (sheet/rollLabel.ts) as stored, worded by each reader's client.
type ExportMessage struct {
	Room          string          `json:"room"`
	At            time.Time       `json:"at"`
	Text          string          `json:"text"`
	Result        *string         `json:"result,omitempty"`
	ResultData    json.RawMessage `json:"resultData,omitempty"`
	Label         json.RawMessage `json:"label,omitempty"`
	CharacterName *string         `json:"characterName,omitempty"`
}

// ChatMessages calls fn with each chat message of the user, by room and time.
func (m *DataExportModel) ChatMessages(ctx context.Context, userID int, fn func(ExportMessage) error) error {
	rows, err := m.DB.Query(ctx, `
SELECT r.name, msg.created_at, msg.message_body, msg.command_result, msg.result_data, msg.label_data, msg.character_name
FROM room_messages msg JOIN rooms r ON r.id = msg.room_id
WHERE msg.user_id = $1
ORDER BY msg.room_id, msg.created_at, msg.id`, userID)
	if err != nil {
		return err
	}
	var msg ExportMessage
	_, err = pgx.ForEachRow(rows, []any{&msg.Room, &msg.At, &msg.Text, &msg.Result, &msg.ResultData, &msg.Label, &msg.CharacterName}, func() error {
		return fn(msg)
	})
	return err
}

func (m *DataExportModel) ForumTopics(ctx context.Context, userID int, fn func(forum.ExportTopic) error) error {
	return forum.ExportTopics(ctx, m.DB, userID, fn)
}

func (m *DataExportModel) ForumPosts(ctx context.Context, userID int, fn func(forum.ExportPost) error) error {
	return forum.ExportPosts(ctx, m.DB, userID, fn)
}

func (m *DataExportModel) ForumProfile(ctx context.Context, userID int) (*forum.ExportProfile, error) {
	return forum.ExportUserProfile(ctx, m.DB, userID)
}

// ExportModeration is what moderators imposed on the user, as the user sees it: no moderator.
type ExportModeration struct {
	ForumBans  []forum.ExportBan `json:"forumBans"`
	AvatarLock *ExportAvatarLock `json:"avatarLock"`
}

type ExportAvatarLock struct {
	Reason    string     `json:"reason"`
	CreatedAt time.Time  `json:"createdAt"`
	Until     *time.Time `json:"until"`
}

func (m *DataExportModel) Moderation(ctx context.Context, userID int) (*ExportModeration, error) {
	bans, err := forum.ExportBans(ctx, m.DB, userID)
	if err != nil {
		return nil, err
	}
	mod := &ExportModeration{ForumBans: bans}
	lock := &ExportAvatarLock{}
	err = m.DB.QueryRow(ctx, `SELECT reason, created_at, until FROM user_avatar_locks WHERE user_id = $1`, userID).
		Scan(&lock.Reason, &lock.CreatedAt, &lock.Until)
	if err == nil {
		mod.AvatarLock = lock
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return mod, nil
}
