package models

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CharacterSheetModelInterface interface {
	Insert(ctx context.Context, userID, RoomID int, kind SheetKind) (int, error)
	InsertWithContent(ctx context.Context, userID, roomID int, kind SheetKind, content json.RawMessage) (int, error)
	Delete(ctx context.Context, userID, sheetID int) ([]int, error)
	ChangeVisibility(ctx context.Context, userID, sheetID int, visibility string) (int, error)
	Get(ctx context.Context, id int) (*CharacterSheet, error)
	ByUser(ctx context.Context, userID int) ([]*CharacterSheet, error)

	// JSON
	CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos json.RawMessage, init json.RawMessage) (int, error)
	ChangeField(ctx context.Context, userID, sheetID int, path []string, newValueJSON []byte) (int, error)
	ApplyBatch(ctx context.Context, userID, sheetID int, path []string, changes []byte) (int, error)
	DeleteItem(ctx context.Context, userID, sheetID int, path []string) (int, error)
	ReplacePositions(ctx context.Context, userID, sheetID int, path []string, positions map[string]Position) (int, error)
	MoveItemBetweenGrids(ctx context.Context, userID, sheetID int, fromPath, toPath []string, itemID string, toPos json.RawMessage) (int, error)

	// DTO
	SummaryByUser(ctx context.Context, ownerID int) ([]*CharacterSheetSummary, error)
	GetWithPermission(ctx context.Context, userID, sheetID int) (*CharacterSheetView, error)
	Audience(ctx context.Context, sheetID int) (*SheetAudience, error)
	QuotaUsed(ctx context.Context, userID int) (int64, error)
	ExportAuthor(ctx context.Context, sheetID int) (*string, error)
}

type SheetVisibility string

const (
	VisibilityEveryoneCanEdit SheetVisibility = "everyone_can_edit"
	VisibilityEveryoneCanView SheetVisibility = "everyone_can_view"
	VisibilityEveryoneCanSee  SheetVisibility = "everyone_can_see"
	VisibilityHideFromPlayers SheetVisibility = "hide_from_players"
)

func (v SheetVisibility) IsValid() bool {
	switch v {
	case
		VisibilityEveryoneCanEdit,
		VisibilityEveryoneCanView,
		VisibilityEveryoneCanSee,
		VisibilityHideFromPlayers:
		return true
	default:
		return false
	}
}

func (v *SheetVisibility) Scan(src any) error {
	var s string

	switch x := src.(type) {
	case string:
		s = x
	case []byte:
		s = string(x)
	default:
		return fmt.Errorf("cannot scan %T into SheetVisibility", src)
	}

	val := SheetVisibility(s)
	if !val.IsValid() {
		return fmt.Errorf("invalid SheetVisibility value: %q", s)
	}

	*v = val
	return nil
}

func (v SheetVisibility) Value() (driver.Value, error) {
	if !v.IsValid() {
		return nil, fmt.Errorf("invalid SheetVisibility value: %q", v)
	}
	return string(v), nil
}

type CharacterSheet struct {
	ID      int
	OwnerID int
	// The home of the sheet: a room for a character, an encounter for an
	// NPC, a bestiary collection for a creature. Exactly one is set (one_home).
	RoomID        *int
	EncounterID   *int
	CollectionID  *int
	CharacterName string
	Content       json.RawMessage
	Visibility    SheetVisibility
	Kind          SheetKind
	FolderID      *int
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type CharacterSheetModel struct {
	DB *pgxpool.Pool
}

func (m *CharacterSheetModel) Insert(ctx context.Context, userID, roomID int, kind SheetKind) (int, error) {
	return m.InsertWithContent(ctx, userID, roomID, kind, json.RawMessage(defaultContent))
}

// InsertWithContent creates a new character sheet with provided JSON content,
// brought to the current shape (currentShape).
func (m *CharacterSheetModel) InsertWithContent(ctx context.Context, userID, roomID int, kind SheetKind, content json.RawMessage) (int, error) {
	content, err := currentShape(content, kind)
	if err != nil {
		return 0, err
	}

	stmt := `
INSERT INTO character_sheets (owner_id, room_id, sheet_kind, content, created_at, updated_at)
VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id`

	var id int
	err = m.DB.QueryRow(ctx, stmt, userID, roomID, kind, content).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

// currentShape brings sheet content to the current shape of test options
// (WithTestOptions), of cognition and energy (WithResourceStats) and of the
// fatigue threshold (WithFatigueThreshold).
func currentShape(content json.RawMessage, kind SheetKind) (json.RawMessage, error) {
	content, err := WithTestOptions(content, kind)
	if err != nil {
		return nil, err
	}
	if content, err = WithResourceStats(content); err != nil {
		return nil, err
	}
	return WithFatigueThreshold(content)
}

// sheetFromFile checks a sheet read from a file, an uploaded creature or an
// NPC of an encounter file, and brings it to the current shape; no kind is
// the default one. The shape, not ValidateCharacterSheetJSON: it wants
// characteristics and skills, which the export of a never edited sheet has
// none of.
func sheetFromFile(kind SheetKind, content json.RawMessage) (SheetKind, json.RawMessage, bool) {
	if kind == "" {
		kind = DefaultSheetKind
	}
	var shape CharacterSheetContent
	if !kind.IsValid() || !strings.HasPrefix(strings.TrimSpace(string(content)), "{") || json.Unmarshal(content, &shape) != nil {
		return "", nil, false
	}
	content, err := currentShape(content, kind)
	if err != nil {
		return "", nil, false
	}
	return kind, content, true
}

// Delete removes a sheet of a room and, in the same transaction, takes it out
// of every encounter it is in (removeParticipants); it returns those
// encounters, whose gamemaster has to get their new state. An NPC goes with
// its encounter or through EncounterModel.Remove, not here.
func (m *CharacterSheetModel) Delete(ctx context.Context, userID, sheetID int) ([]int, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var id int
	err = tx.QueryRow(ctx, `
        SELECT id FROM character_sheets
        WHERE id = $1
          AND room_id IS NOT NULL
          AND can_edit_character_sheet($2, $1)
        FOR UPDATE`, sheetID, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPermissionDenied
	}
	if err != nil {
		return nil, err
	}

	encounters, err := removeSheetFromEncounters(ctx, tx, sheetID)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM character_sheets WHERE id = $1`, sheetID); err != nil {
		return nil, err
	}
	return encounters, tx.Commit(ctx)
}

func (m *CharacterSheetModel) Get(ctx context.Context, id int) (*CharacterSheet, error) {
	const stmt = `
	SELECT id, 
		owner_id,
		room_id,
		encounter_id,
		collection_id,
		character_name, 
		content,
		sheet_visibility,
		sheet_kind,
		folder_id,
		created_at,
		updated_at
	FROM character_sheets
	WHERE id = $1`

	row := m.DB.QueryRow(ctx, stmt, id)

	s := &CharacterSheet{}
	err := row.Scan(
		&s.ID,
		&s.OwnerID,
		&s.RoomID,
		&s.EncounterID,
		&s.CollectionID,
		&s.CharacterName,
		&s.Content,
		&s.Visibility,
		&s.Kind,
		&s.FolderID,
		&s.CreatedAt,
		&s.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}
	return s, nil
}

func (m *CharacterSheetModel) ChangeVisibility(ctx context.Context, userID, sheetID int, visibility string) (int, error) {
	const stmt = `
        UPDATE character_sheets
        SET sheet_visibility = $1::sheet_visibility,
            version = version + 1,
            updated_at = now()
        WHERE id = $2
          AND owner_id = $3
        RETURNING version
    `
	var version int
	err := m.DB.QueryRow(ctx, stmt, visibility, sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

func (m *CharacterSheetModel) ByUser(ctx context.Context, ownerID int) ([]*CharacterSheet, error) {
	const stmt = `
	SELECT id, 
		owner_id, 
		character_name, 
		created_at, 
		updated_at
	FROM character_sheets
	WHERE owner_id = $1`

	rows, err := m.DB.Query(ctx, stmt, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sheets := []*CharacterSheet{}

	for rows.Next() {
		s := &CharacterSheet{}
		if err := rows.Scan(
			&s.ID,
			&s.OwnerID,
			&s.CharacterName,
			&s.CreatedAt,
			&s.UpdatedAt,
		); err != nil {
			return nil, err
		}
		sheets = append(sheets, s)
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return sheets, nil
}

type CharacterSheetSummary struct {
	CharacterSheet *CharacterSheet
	RoomID         int
	RoomName       string
}

func (m *CharacterSheetModel) SummaryByUser(ctx context.Context, ownerID int) ([]*CharacterSheetSummary, error) {
	const stmt = `
SELECT
  cs.id,
  cs.owner_id,
  cs.room_id,
  r.name AS room_name,
  cs.content,
  cs.character_name,
  cs.created_at,
  cs.updated_at
FROM character_sheets AS cs
JOIN rooms AS r ON r.id = cs.room_id
WHERE cs.owner_id = $1
ORDER BY cs.updated_at DESC;`

	rows, err := m.DB.Query(ctx, stmt, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var views []*CharacterSheetSummary

	for rows.Next() {
		var (
			id            int
			ownerID       int
			roomID        int
			roomName      string
			contentBytes  []byte
			characterName string
			createdAt     time.Time
			updatedAt     time.Time
		)

		if err := rows.Scan(
			&id,
			&ownerID,
			&roomID,
			&roomName,
			&contentBytes,
			&characterName,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, err
		}

		sheet := &CharacterSheet{
			ID:            id,
			OwnerID:       ownerID,
			RoomID:        &roomID,
			CharacterName: characterName,
			Content:       json.RawMessage(contentBytes),
			CreatedAt:     createdAt,
			UpdatedAt:     updatedAt,
		}

		views = append(views, &CharacterSheetSummary{
			CharacterSheet: sheet,
			RoomID:         roomID,
			RoomName:       roomName,
		})
	}

	if err = rows.Err(); err != nil {
		return nil, err
	}

	return views, nil
}

func replaceLastSegment(path []string, from, to string) ([]string, error) {
	result := make([]string, len(path))
	copy(result, path)

	found := false
	for i := len(result) - 1; i >= 0; i-- {
		if result[i] == from {
			result[i] = to
			found = true
			break
		}
	}

	if !found {
		return nil, fmt.Errorf("segment '%s' not found in path", from)
	}

	return result, nil
}

func (m *CharacterSheet) UnmarshalContent() (*CharacterSheetContent, error) {
	if len(m.Content) == 0 {
		return nil, ErrNoContent
	}

	var content CharacterSheetContent
	if err := json.Unmarshal(m.Content, &content); err != nil {
		return nil, err
	}

	return &content, nil
}

// DTO for view with permission info
type CharacterSheetView struct {
	CharacterSheet *CharacterSheet
	// HomeRoomID is the room of the sheet's home: its own, or its encounter's;
	// 0 for a creature, which is in no room.
	HomeRoomID int
	CanEdit    bool
	CanView    bool
}

func (m *CharacterSheetModel) GetWithPermission(ctx context.Context, userID, sheetID int) (*CharacterSheetView, error) {
	const stmt = `
        SELECT 
            cs.id,
            cs.owner_id,
            cs.room_id,
            cs.encounter_id,
            cs.collection_id,
            COALESCE(cs.room_id, e.room_id, 0),
            cs.character_name,
            cs.content,
            cs.created_at,
            cs.updated_at,
            cs.sheet_visibility,
            cs.sheet_kind,
            cs.folder_id,
			can_view_character_sheet($1, cs.id) AS can_view,
            can_edit_character_sheet($1, cs.id) AS can_edit
        FROM character_sheets cs
        LEFT JOIN encounters e ON e.id = cs.encounter_id
        WHERE cs.id = $2
    `

	row := m.DB.QueryRow(ctx, stmt, userID, sheetID)

	s := &CharacterSheet{}
	var homeRoomID int
	var canView, canEdit bool

	err := row.Scan(
		&s.ID,
		&s.OwnerID,
		&s.RoomID,
		&s.EncounterID,
		&s.CollectionID,
		&homeRoomID,
		&s.CharacterName,
		&s.Content,
		&s.CreatedAt,
		&s.UpdatedAt,
		&s.Visibility,
		&s.Kind,
		&s.FolderID,
		&canView,
		&canEdit,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}

	// Check if user has view permission
	if !canView {
		return nil, ErrPermissionDenied
	}

	return &CharacterSheetView{
		CharacterSheet: s,
		HomeRoomID:     homeRoomID,
		CanView:        canView,
		CanEdit:        canEdit,
	}, nil
}

// SheetAudience is who may receive the edits of a sheet over the room socket.
type SheetAudience struct {
	// RoomID is the room of the sheet's home, its own or its encounter's; an
	// edit coming through the socket of another room is rejected. A creature
	// is in no room: 0, which no room has.
	RoomID int
	// Viewers are the members of that room for whom can_view_character_sheet
	// holds: the rest must not see the edits in their WebSocket traffic.
	Viewers []int
	// Named are the viewers and the members whose room list shows the sheet
	// without letting them open it (everyone_can_see): the list renames it.
	Named []int
	// CollectionOwnerID is the owner of a creature's collection, whose
	// bestiary socket takes its edits; 0 for a room's sheet and an NPC.
	CollectionOwnerID int
}

func (m *CharacterSheetModel) Audience(ctx context.Context, sheetID int) (*SheetAudience, error) {
	// The list shows a sheet to everyone unless it is hidden; a sheet in a
	// folder takes the folder's visibility (room/characters.ts). An NPC is in
	// no list: only its viewers, the gamemaster, learn its name.
	const stmt = `
        SELECT
            h.room_id,
            ARRAY(
                SELECT rm.user_id
                FROM room_members rm
                WHERE rm.room_id = h.room_id
                  AND can_view_character_sheet(rm.user_id, cs.id)
            ),
            ARRAY(
                SELECT rm.user_id
                FROM room_members rm
                WHERE rm.room_id = h.room_id
                  AND ((cs.room_id IS NOT NULL
                        AND COALESCE(f.folder_visibility, cs.sheet_visibility) <> 'hide_from_players')
                       OR can_view_character_sheet(rm.user_id, cs.id))
            ),
            COALESCE(bc.owner_id, 0)
        FROM character_sheets cs
        LEFT JOIN encounters e ON e.id = cs.encounter_id
        LEFT JOIN bestiary_collections bc ON bc.id = cs.collection_id
        CROSS JOIN LATERAL (SELECT COALESCE(cs.room_id, e.room_id, 0) AS room_id) h
        LEFT JOIN character_sheet_folders f ON f.id = cs.folder_id
        WHERE cs.id = $1
    `

	a := &SheetAudience{}
	err := m.DB.QueryRow(ctx, stmt, sheetID).Scan(&a.RoomID, &a.Viewers, &a.Named, &a.CollectionOwnerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}
	return a, nil
}

// querier is a pool or a transaction.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// QuotaBytes is what the NPCs and the creatures of a user may take as they
// are stored, compressed: some 35 MB of their JSON. The characters in rooms do
// not count.
const QuotaBytes = 5 << 20

// QuotaError is a new sheet that does not fit into its owner's quota.
type QuotaError struct {
	Used, Adding, Limit int64
}

func (e *QuotaError) Error() string {
	return fmt.Sprintf("models: quota exceeded: %d of %d bytes used, %d more needed", e.Used, e.Limit, e.Adding)
}

// Message is the error as the user reads it, over the socket and over HTTP.
func (e *QuotaError) Message() string {
	return fmt.Sprintf("NPCs and creatures take %.1f of %.0f MB; this needs %.1f MB more.",
		float64(e.Used)/(1<<20), float64(e.Limit)/(1<<20), float64(e.Adding)/(1<<20))
}

// quotaUsed is what the NPCs and the creatures of the user take. The sum is
// counted when it is needed: a stored one would change on every edit of any
// sheet. pg_column_size is the stored size, which Postgres reads off the
// value's header without unpacking the content.
func quotaUsed(ctx context.Context, q querier, userID int) (int64, error) {
	var used int64
	err := q.QueryRow(ctx, `
        SELECT COALESCE(SUM(pg_column_size(content)), 0)
        FROM character_sheets
        WHERE owner_id = $1 AND (encounter_id IS NOT NULL OR collection_id IS NOT NULL)`, userID).Scan(&used)
	return used, err
}

func (m *CharacterSheetModel) QuotaUsed(ctx context.Context, userID int) (int64, error) {
	return quotaUsed(ctx, m.DB, userID)
}

// ExportAuthor is the author an exported file of the sheet names: the owner
// of a sheet of a room, else its author.
func (m *CharacterSheetModel) ExportAuthor(ctx context.Context, sheetID int) (*string, error) {
	var author *string
	err := m.DB.QueryRow(ctx, `
        SELECT CASE WHEN cs.room_id IS NOT NULL THEN (SELECT name FROM users WHERE id = cs.owner_id) ELSE `+authorName+` END
        FROM character_sheets cs WHERE cs.id = $1`, sheetID).Scan(&author)
	return author, err
}

// lockQuota holds the quota of the user until the transaction ends, so that
// two copies at once do not both fit, and returns what is used before the
// writes that checkQuota checks.
func lockQuota(ctx context.Context, tx querier, userID int) (int64, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(`+quotaLock+`, $1)`, userID); err != nil {
		return 0, err
	}
	return quotaUsed(ctx, tx, userID)
}

// The first key of the advisory lock of a user's quota; the second is the user.
const quotaLock = "1"

// checkQuota fails with a QuotaError when the sheets the transaction wrote
// since lockQuota, which found `before` used, are over the quota: a sheet's
// stored size is known once it is written, and the error rolls it back. Only
// new sheets are checked: edits may grow a sheet past the quota.
func checkQuota(ctx context.Context, tx querier, userID int, before int64) error {
	after, err := quotaUsed(ctx, tx, userID)
	if err != nil {
		return err
	}
	if after > QuotaBytes {
		return &QuotaError{Used: before, Adding: after - before, Limit: QuotaBytes}
	}
	return nil
}

// SheetHome is where a new sheet lives; exactly one field is set.
type SheetHome struct {
	RoomID       *int
	EncounterID  *int
	CollectionID *int
}

// copySheet copies sheet srcID, which userID must be able to view, into
// `home` as a sheet of userID named `name`, within the quota. The copy
// remembers its source. Its source label is "collection · owner" when the
// source is another user's creature, else the source's own label; its author
// is the source's, the owner's for a sheet of a room.
func copySheet(ctx context.Context, q querier, userID, srcID int, home SheetHome, name string) (int, error) {
	var visible bool
	if err := q.QueryRow(ctx, `SELECT can_view_character_sheet($1, $2)`, userID, srcID).Scan(&visible); err != nil {
		return 0, err
	}
	if !visible {
		return 0, ErrPermissionDenied
	}
	before, err := lockQuota(ctx, q, userID)
	if err != nil {
		return 0, err
	}

	var id int
	err = q.QueryRow(ctx, `
        INSERT INTO character_sheets (owner_id, author_id, author_label, room_id, encounter_id, collection_id, sheet_kind, content, source_sheet_id, source_label, created_at, updated_at)
        SELECT $2, CASE WHEN cs.room_id IS NOT NULL THEN cs.owner_id ELSE cs.author_id END, cs.author_label,
               $3, $4, $5, cs.sheet_kind, jsonb_set(cs.content, '{characterInfo,characterName}', to_jsonb($6::text)), cs.id,
               CASE WHEN c.owner_id <> $2 THEN c.name || ' · ' || u.name ELSE cs.source_label END,
               now(), now()
        FROM character_sheets cs
        LEFT JOIN bestiary_collections c ON c.id = cs.collection_id
        LEFT JOIN users u ON u.id = c.owner_id
        WHERE cs.id = $1
        RETURNING id`, srcID, userID, home.RoomID, home.EncounterID, home.CollectionID, name).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, checkQuota(ctx, q, userID, before)
}
