package models

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Encounters of a room and their participants (_prd/gm_mode/data-model.md).
// Everything here is the gamemaster's: every method checks that the user is
// the gamemaster of the encounter's room.
type EncounterModelInterface interface {
	List(ctx context.Context, userID, roomID int) (*EncounterList, error)
	// ShownView is the initiative view of the encounter shown to the players
	// of the room; nil when none is shown or it has no view yet.
	ShownView(ctx context.Context, roomID int) (*InitiativeView, error)
	Gamemasters(ctx context.Context, roomID int) ([]int, error)
	Get(ctx context.Context, userID, encounterID int) (*EncounterState, error)
	// State is the encounter without a permission check, for what the server
	// sends its gamemaster on its own, e.g. after a player deleted a sheet.
	State(ctx context.Context, encounterID int) (*EncounterState, error)

	Create(ctx context.Context, userID, roomID int, name string) (*EncounterState, error)
	Rename(ctx context.Context, ref EncounterRef, name string) (*EncounterState, error)
	// Delete removes the encounter with its NPCs; it returns whether it was
	// the shown one.
	Delete(ctx context.Context, ref EncounterRef) (bool, error)
	// Show shows the encounter to the players of the room, or none with nil;
	// it returns the view they now see.
	Show(ctx context.Context, userID, roomID int, encounterID *int) (*InitiativeView, error)

	// Describe sets the gamemaster's notes on the encounter.
	Describe(ctx context.Context, ref EncounterRef, description string) (*EncounterState, error)

	// A change of the party of a room reaches all the encounters of the room,
	// none for a room without any; a change of the NPCs of an encounter
	// reaches that one. Remove, Move, Group and Ungroup change the party for
	// characters and the encounter for NPCs. The change has the state of the
	// encounter of ref only.

	// PartyAdd adds sheets of the room to its party, and so to every
	// encounter of it; ref.EncounterID 0 names no encounter.
	PartyAdd(ctx context.Context, ref EncounterRef, sheetIDs []int) (*EncountersChange, error)
	Duplicate(ctx context.Context, ref EncounterRef, participantID, count int) (*EncounterState, error)
	// AddCreature adds `count` NPCs copied from a creature the user can view,
	// theirs or of a collection shared with them.
	AddCreature(ctx context.Context, ref EncounterRef, creatureID, count int) (*EncounterState, error)
	// Remove takes characters out of the party, or deletes NPCs; not both.
	Remove(ctx context.Context, ref EncounterRef, participantIDs []int) (*EncountersChange, error)
	// Move puts the participant into column `side`, in a group of its own if
	// it shared one.
	Move(ctx context.Context, ref EncounterRef, participantID int, side string) (*EncountersChange, error)
	SetDisplayName(ctx context.Context, ref EncounterRef, participantID int, name string) (*EncountersChange, error)
	Group(ctx context.Context, ref EncounterRef, participantIDs []int, name string) (*EncountersChange, error)
	Ungroup(ctx context.Context, ref EncounterRef, groupID int) (*EncountersChange, error)
	// Changed is the change of encounters of the room the server knows by
	// their ids only: those a deleted sheet left. It has no state.
	Changed(ctx context.Context, roomID int, encounterIDs []int) (*EncountersChange, error)
	// Order stores the positions of groups the gamemaster's client sorted
	// and the view it made of them.
	Order(ctx context.Context, ref EncounterRef, positions map[int]int, view *InitiativeView) (*EncounterState, error)
	// DropView takes the view away from the players: the gamemaster opened
	// another encounter. Their client makes it again when they come back.
	DropView(ctx context.Context, ref EncounterRef) (*EncounterState, error)
	Next(ctx context.Context, ref EncounterRef) (*EncounterState, error)
	// Prev takes the turn back; from the first turn of the first round, to none.
	Prev(ctx context.Context, ref EncounterRef) (*EncounterState, error)
	ResetInitiative(ctx context.Context, ref EncounterRef) (*EncounterState, error)
	// CheckNpcs fails unless every sheet is an NPC of the encounter.
	CheckNpcs(ctx context.Context, ref EncounterRef, sheetIDs []int) error

	// Export is the encounter's file: its NPCs and their groups.
	Export(ctx context.Context, userID, encounterID int) (*EncounterFile, error)
	Load(ctx context.Context, userID, roomID int, f *EncounterFile) (*EncounterState, error)
	ReplaceNpcs(ctx context.Context, ref EncounterRef, f *EncounterFile) (*EncounterState, error)
}

// EncounterRef is an encounter as a request names it: the room of the socket
// it came through and the user who sent it.
type EncounterRef struct {
	UserID      int
	RoomID      int
	EncounterID int
}

// ErrInvalidEncounterRequest is a request the encounter cannot take: a
// participant or group of another encounter, a group across the columns.
var ErrInvalidEncounterRequest = errors.New("models: invalid encounter request")

const (
	maxEncounterName  = 100
	maxDisplayName    = 100
	maxDuplicates     = 20
	maxEncounterNotes = 10000
)

// The columns of the encounter window, encounter_side in the database.
const (
	SideParty   = "party"
	SideEnemies = "enemies"
)

type EncounterModel struct {
	DB *pgxpool.Pool
}

// EncountersChange is what a change that may reach the party of a room, and
// so every encounter of it, did.
type EncountersChange struct {
	// State is the encounter the request named, after the change; nil when it
	// named none.
	State *EncounterState
	// Versions is every encounter the change reached, that one too, by id.
	Versions []EncounterVersion
	// Shown is whether the encounter shown to the players is among them, and
	// ShownView the view the players have of it now.
	Shown     bool
	ShownView *InitiativeView
}

// changeOf is the change of the encounters of `versions` of the room, without
// a state.
func changeOf(ctx context.Context, q querier, roomID int, versions []EncounterVersion) (*EncountersChange, error) {
	shownID, view, err := shownOf(ctx, q, roomID)
	if err != nil {
		return nil, err
	}
	c := &EncountersChange{Versions: versions}
	c.Shown = slices.ContainsFunc(versions, func(v EncounterVersion) bool { return v.ID == shownID })
	if c.Shown {
		c.ShownView = view
	}
	return c, nil
}

func scanVersions(rows pgx.Rows) ([]EncounterVersion, error) {
	versions, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (EncounterVersion, error) {
		var v EncounterVersion
		return v, row.Scan(&v.ID, &v.Version)
	})
	slices.SortFunc(versions, func(a, b EncounterVersion) int { return a.ID - b.ID })
	return versions, err
}

// cleanName trims a name the user typed; "" is not ok unless `empty` allows it.
func cleanName(name string, max int, empty bool) (string, bool) {
	name = strings.TrimSpace(name)
	if (name == "" && !empty) || utf8.RuneCountInString(name) > max {
		return "", false
	}
	return name, true
}

func isGamemaster(ctx context.Context, q querier, userID, roomID int) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `
        SELECT EXISTS (
            SELECT 1 FROM room_members
            WHERE room_id = $1 AND user_id = $2 AND role = 'gamemaster'
        )`, roomID, userID).Scan(&ok)
	return ok, err
}

// lockEncounter locks the encounter of `ref` for the rest of the transaction,
// once it is known to be of ref's room with ref's user its gamemaster.
func lockEncounter(ctx context.Context, tx pgx.Tx, ref EncounterRef) error {
	var gm bool
	err := tx.QueryRow(ctx, `
        SELECT EXISTS (
            SELECT 1 FROM room_members rm
            WHERE rm.room_id = e.room_id AND rm.user_id = $2 AND rm.role = 'gamemaster'
        )
        FROM encounters e
        WHERE e.id = $1 AND e.room_id = $3
        FOR UPDATE OF e`, ref.EncounterID, ref.UserID, ref.RoomID).Scan(&gm)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !gm) {
		return ErrPermissionDenied
	}
	return err
}

// mutate runs `change` on the locked encounter of `ref` in one transaction and
// returns the encounter as it is after it.
func (m *EncounterModel) mutate(ctx context.Context, ref EncounterRef, change func(tx pgx.Tx) error) (*EncounterState, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if err := lockEncounter(ctx, tx, ref); err != nil {
		return nil, err
	}
	if err := change(tx); err != nil {
		return nil, err
	}
	if err := touch(ctx, tx, ref.EncounterID); err != nil {
		return nil, err
	}
	state, err := loadEncounter(ctx, tx, ref.EncounterID)
	if err != nil {
		return nil, err
	}
	return state, tx.Commit(ctx)
}

// mutateParty runs `change` on the party of ref's room in one transaction,
// with all the encounters of the room locked, and returns the change with the
// state of ref's encounter, which must be of the room unless it is 0.
func (m *EncounterModel) mutateParty(ctx context.Context, ref EncounterRef, change func(tx pgx.Tx, encounters []int) error) (*EncountersChange, error) {
	roomID := ref.RoomID
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	gm, err := isGamemaster(ctx, tx, ref.UserID, roomID)
	if err != nil {
		return nil, err
	}
	if !gm {
		return nil, ErrPermissionDenied
	}
	encounters, err := roomEncounters(ctx, tx, roomID, true)
	if err != nil {
		return nil, err
	}
	if ref.EncounterID != 0 && !slices.Contains(encounters, ref.EncounterID) {
		return nil, ErrPermissionDenied
	}
	// Without encounters, only the room keeps two changes of the party apart.
	// It is locked after them, in the order deleting the shown encounter
	// locks both (its foreign key clears rooms.shown_encounter_id).
	if _, err := tx.Exec(ctx, `SELECT 1 FROM rooms WHERE id = $1 FOR NO KEY UPDATE`, roomID); err != nil {
		return nil, err
	}
	if err := change(tx, encounters); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `
        UPDATE encounters SET version = version + 1, updated_at = now() WHERE id = ANY($1)
        RETURNING id, version`, encounters)
	if err != nil {
		return nil, err
	}
	versions, err := scanVersions(rows)
	if err != nil {
		return nil, err
	}
	c, err := changeOf(ctx, tx, roomID, versions)
	if err != nil {
		return nil, err
	}
	if ref.EncounterID != 0 {
		if c.State, err = loadEncounter(ctx, tx, ref.EncounterID); err != nil {
			return nil, err
		}
	}
	return c, tx.Commit(ctx)
}

// mutateIn runs `change` with mutateParty on the party of ref's room, or with
// mutate on ref's encounter; `encounters` is those the change reaches.
func (m *EncounterModel) mutateIn(ctx context.Context, ref EncounterRef, party bool, change func(tx pgx.Tx, encounters []int) error) (*EncountersChange, error) {
	if party {
		return m.mutateParty(ctx, ref, change)
	}
	state, err := m.mutate(ctx, ref, func(tx pgx.Tx) error {
		return change(tx, []int{ref.EncounterID})
	})
	if err != nil {
		return nil, err
	}
	return &EncountersChange{
		State:    state,
		Versions: []EncounterVersion{{ID: state.ID, Version: state.Version}},
		Shown:    state.Shown, ShownView: state.InitiativeView,
	}, nil
}

// partyOf tells whether the participants are of a party rather than NPCs, by
// any of them: the change then finds them all there or fails. It is read
// before the lock, which depends on it; the home of a participant never
// changes.
func partyOf(ctx context.Context, q querier, participantIDs []int) (bool, error) {
	var party bool
	err := q.QueryRow(ctx, `
        SELECT COALESCE(bool_or(room_id IS NOT NULL), false)
        FROM encounter_participants WHERE id = ANY($1)`, participantIDs).Scan(&party)
	return party, err
}

// resetViews drops the views of the encounters, which have the rows of the
// party as it was. Only the gamemaster's client can count a new one: until it
// does, the players see no order rather than a wrong one.
func resetViews(ctx context.Context, q querier, encounters []int) error {
	_, err := q.Exec(ctx, `UPDATE encounters SET initiative_view = NULL WHERE id = ANY($1)`, encounters)
	return err
}

func touch(ctx context.Context, q querier, encounterID int) error {
	_, err := q.Exec(ctx, `UPDATE encounters SET version = version + 1, updated_at = now() WHERE id = $1`, encounterID)
	return err
}

func loadEncounter(ctx context.Context, q querier, encounterID int) (*EncounterState, error) {
	s := &EncounterState{Groups: []EncounterGroup{}, Participants: []EncounterParticipant{}}
	var view []byte
	err := q.QueryRow(ctx, `
        SELECT e.id, e.room_id, e.name, e.description, e.round, e.current_group_id,
               r.shown_encounter_id IS NOT DISTINCT FROM e.id,
               e.initiative_view, e.version, e.updated_at
        FROM encounters e
        JOIN rooms r ON r.id = e.room_id
        WHERE e.id = $1`, encounterID).Scan(
		&s.ID, &s.RoomID, &s.Name, &s.Description, &s.Round, &s.CurrentGroupID, &s.Shown, &view, &s.Version, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	if err != nil {
		return nil, err
	}
	if view != nil {
		if err := json.Unmarshal(view, &s.InitiativeView); err != nil {
			return nil, err
		}
	}

	rows, err := q.Query(ctx, `
        SELECT g.id, ip.position, g.name, g.room_id IS NOT NULL
        FROM initiative_groups g
        LEFT JOIN initiative_positions ip ON ip.encounter_id = $1 AND ip.group_id = g.id
        WHERE g.encounter_id = $1 OR g.room_id = $2
        ORDER BY ip.position NULLS LAST, g.id`, encounterID, s.RoomID)
	if err != nil {
		return nil, err
	}
	s.Groups, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (EncounterGroup, error) {
		var g EncounterGroup
		return g, row.Scan(&g.ID, &g.Position, &g.Name, &g.Room)
	})
	if err != nil {
		return nil, err
	}

	// The source of an NPC counts only while it is a creature of the NPC's
	// owner: "Add variant to bestiary" puts the variant next to it.
	rows, err = q.Query(ctx, `
        SELECT p.id, p.group_id, p.sheet_id, p.display_name,
               cs.encounter_id IS NOT NULL, p.side,
               cs.character_name,
               CASE WHEN sc.id IS NOT NULL THEN src.id END,
               CASE WHEN sc.id IS NOT NULL THEN src.character_name END,
               CASE WHEN cs.encounter_id IS NOT NULL THEN cs.source_label END
        FROM encounter_participants p
        JOIN character_sheets cs ON cs.id = p.sheet_id
        LEFT JOIN character_sheets src ON src.id = cs.source_sheet_id AND cs.encounter_id IS NOT NULL
        LEFT JOIN bestiary_collections sc ON sc.id = src.collection_id AND sc.owner_id = cs.owner_id
        WHERE p.encounter_id = $1 OR p.room_id = $2
        ORDER BY p.id`, encounterID, s.RoomID)
	if err != nil {
		return nil, err
	}
	s.Participants, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (EncounterParticipant, error) {
		var p EncounterParticipant
		return p, row.Scan(&p.ID, &p.GroupID, &p.SheetID, &p.DisplayName, &p.NPC, &p.Side, &p.Name, &p.SourceCreatureID, &p.SourceCreatureName, &p.SourceLabel)
	})
	return s, err
}

func (m *EncounterModel) List(ctx context.Context, userID, roomID int) (*EncounterList, error) {
	gm, err := isGamemaster(ctx, m.DB, userID, roomID)
	if err != nil {
		return nil, err
	}
	if !gm {
		return nil, ErrPermissionDenied
	}
	list := &EncounterList{}
	if err := m.DB.QueryRow(ctx, `SELECT shown_encounter_id FROM rooms WHERE id = $1`, roomID).Scan(&list.ShownEncounterID); err != nil {
		return nil, err
	}
	rows, err := m.DB.Query(ctx, `
        SELECT id, name, updated_at FROM encounters
        WHERE room_id = $1
        ORDER BY updated_at DESC, id DESC`, roomID)
	if err != nil {
		return nil, err
	}
	list.Encounters, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (EncounterSummary, error) {
		var e EncounterSummary
		return e, row.Scan(&e.ID, &e.Name, &e.UpdatedAt)
	})
	return list, err
}

func (m *EncounterModel) ShownView(ctx context.Context, roomID int) (*InitiativeView, error) {
	_, view, err := shownOf(ctx, m.DB, roomID)
	return view, err
}

// shownOf returns the encounter the room shows its players, 0 for none, and
// their view of it.
func shownOf(ctx context.Context, q querier, roomID int) (int, *InitiativeView, error) {
	var id int
	var view []byte
	err := q.QueryRow(ctx, `
        SELECT e.id, e.initiative_view
        FROM rooms r
        JOIN encounters e ON e.id = r.shown_encounter_id
        WHERE r.id = $1`, roomID).Scan(&id, &view)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, nil
	}
	if err != nil || view == nil {
		return id, nil, err
	}
	var v InitiativeView
	return id, &v, json.Unmarshal(view, &v)
}

func (m *EncounterModel) Changed(ctx context.Context, roomID int, encounterIDs []int) (*EncountersChange, error) {
	rows, err := m.DB.Query(ctx, `SELECT id, version FROM encounters WHERE id = ANY($1) AND room_id = $2`, encounterIDs, roomID)
	if err != nil {
		return nil, err
	}
	versions, err := scanVersions(rows)
	if err != nil {
		return nil, err
	}
	return changeOf(ctx, m.DB, roomID, versions)
}

func (m *EncounterModel) Gamemasters(ctx context.Context, roomID int) ([]int, error) {
	rows, err := m.DB.Query(ctx, `SELECT user_id FROM room_members WHERE room_id = $1 AND role = 'gamemaster'`, roomID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[int])
}

func (m *EncounterModel) Get(ctx context.Context, userID, encounterID int) (*EncounterState, error) {
	var roomID int
	err := m.DB.QueryRow(ctx, `SELECT room_id FROM encounters WHERE id = $1`, encounterID).Scan(&roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	if err != nil {
		return nil, err
	}
	gm, err := isGamemaster(ctx, m.DB, userID, roomID)
	if err != nil {
		return nil, err
	}
	if !gm {
		return nil, ErrPermissionDenied
	}
	return loadEncounter(ctx, m.DB, encounterID)
}

func (m *EncounterModel) State(ctx context.Context, encounterID int) (*EncounterState, error) {
	return loadEncounter(ctx, m.DB, encounterID)
}

func (m *EncounterModel) Create(ctx context.Context, userID, roomID int, name string) (*EncounterState, error) {
	name, ok := cleanName(name, maxEncounterName, false)
	if !ok {
		return nil, ErrInvalidEncounterRequest
	}
	gm, err := isGamemaster(ctx, m.DB, userID, roomID)
	if err != nil {
		return nil, err
	}
	if !gm {
		return nil, ErrPermissionDenied
	}
	var id int
	if err := m.DB.QueryRow(ctx, `INSERT INTO encounters (room_id, name) VALUES ($1, $2) RETURNING id`, roomID, name).Scan(&id); err != nil {
		return nil, err
	}
	return loadEncounter(ctx, m.DB, id)
}

func (m *EncounterModel) Rename(ctx context.Context, ref EncounterRef, name string) (*EncounterState, error) {
	name, ok := cleanName(name, maxEncounterName, false)
	if !ok {
		return nil, ErrInvalidEncounterRequest
	}
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE encounters SET name = $2 WHERE id = $1`, ref.EncounterID, name)
		return err
	})
}

func (m *EncounterModel) Describe(ctx context.Context, ref EncounterRef, description string) (*EncounterState, error) {
	if utf8.RuneCountInString(description) > maxEncounterNotes {
		return nil, ErrInvalidEncounterRequest
	}
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE encounters SET description = $2 WHERE id = $1`, ref.EncounterID, description)
		return err
	})
}

func (m *EncounterModel) Delete(ctx context.Context, ref EncounterRef) (bool, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	if err := lockEncounter(ctx, tx, ref); err != nil {
		return false, err
	}
	var shown bool
	err = tx.QueryRow(ctx, `SELECT shown_encounter_id IS NOT DISTINCT FROM $1 FROM rooms WHERE id = $2`, ref.EncounterID, ref.RoomID).Scan(&shown)
	if err != nil {
		return false, err
	}
	// Its NPCs, groups and participants go with it; the room shows none.
	if _, err := tx.Exec(ctx, `DELETE FROM encounters WHERE id = $1`, ref.EncounterID); err != nil {
		return false, err
	}
	return shown, tx.Commit(ctx)
}

func (m *EncounterModel) Show(ctx context.Context, userID, roomID int, encounterID *int) (*InitiativeView, error) {
	gm, err := isGamemaster(ctx, m.DB, userID, roomID)
	if err != nil {
		return nil, err
	}
	if !gm {
		return nil, ErrPermissionDenied
	}
	tag, err := m.DB.Exec(ctx, `
        UPDATE rooms SET shown_encounter_id = $2
        WHERE id = $1
          AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM encounters WHERE id = $2 AND room_id = $1))`, roomID, encounterID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrPermissionDenied
	}
	return m.ShownView(ctx, roomID)
}

// appendGroup adds a group to the encounter, last in its turn order.
func appendGroup(ctx context.Context, q querier, encounterID int, name *string) (int, error) {
	var groupID int
	err := q.QueryRow(ctx, `
        WITH g AS (
            INSERT INTO initiative_groups (encounter_id, name) VALUES ($1, $2)
            RETURNING id
        ), placed AS (
            INSERT INTO initiative_positions (encounter_id, group_id, position)
            SELECT $1, g.id, (SELECT COALESCE(MAX(position), -1) + 1 FROM initiative_positions WHERE encounter_id = $1)
            FROM g
        )
        SELECT id FROM g`, encounterID, name).Scan(&groupID)
	return groupID, err
}

// groupAt adds a group to the party of ref's room, or to its encounter, that
// takes in each encounter the first place among groups `from`.
func groupAt(ctx context.Context, q querier, ref EncounterRef, party bool, name *string, from []int) (int, error) {
	var groupID int
	err := q.QueryRow(ctx, `
        WITH g AS (
            INSERT INTO initiative_groups (encounter_id, room_id, name)
            VALUES (CASE WHEN NOT $3 THEN $1::int END, CASE WHEN $3 THEN $2::int END, $4)
            RETURNING id
        ), placed AS (
            INSERT INTO initiative_positions (encounter_id, group_id, position)
            SELECT ip.encounter_id, g.id, MIN(ip.position)
            FROM initiative_positions ip, g
            WHERE ip.group_id = ANY($5)
            GROUP BY ip.encounter_id, g.id
        )
        SELECT id FROM g`, ref.EncounterID, ref.RoomID, party, name, from).Scan(&groupID)
	return groupID, err
}

// addParticipant puts the NPC into the encounter in a group of its own,
// last in the turn order until the gamemaster's client sorts it.
func addParticipant(ctx context.Context, q querier, encounterID, sheetID int, displayName *string, side string) error {
	groupID, err := appendGroup(ctx, q, encounterID, nil)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `
        INSERT INTO encounter_participants (encounter_id, group_id, sheet_id, display_name, side)
        VALUES ($1, $2, $3, $4, $5)`, encounterID, groupID, sheetID, displayName, side)
	return err
}

func (m *EncounterModel) PartyAdd(ctx context.Context, ref EncounterRef, sheetIDs []int) (*EncountersChange, error) {
	roomID := ref.RoomID
	return m.mutateParty(ctx, ref, func(tx pgx.Tx, encounters []int) error {
		added := false
		for _, sheetID := range sheetIDs {
			// Only the sheets of the room: the gamemaster sees them all. An NPC
			// has no room_id, so the comparison is NULL for it.
			var inRoom, in bool
			err := tx.QueryRow(ctx, `
                SELECT COALESCE(cs.room_id = $2, false),
                       EXISTS (SELECT 1 FROM encounter_participants p WHERE p.room_id = $2 AND p.sheet_id = cs.id)
                FROM character_sheets cs
                WHERE cs.id = $1`, sheetID, roomID).Scan(&inRoom, &in)
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && !inRoom) {
				return ErrInvalidEncounterRequest
			}
			if err != nil {
				return err
			}
			if in {
				continue
			}
			// Unsorted in every encounter, the group comes last in each.
			_, err = tx.Exec(ctx, `
                WITH g AS (INSERT INTO initiative_groups (room_id) VALUES ($1) RETURNING id)
                INSERT INTO encounter_participants (room_id, group_id, sheet_id, side)
                SELECT $1, g.id, $2, 'party' FROM g`, roomID, sheetID)
			if err != nil {
				return err
			}
			added = true
		}
		if added {
			return resetViews(ctx, tx, encounters)
		}
		return nil
	})
}

var numbered = regexp.MustCompile(`^(.*?) (\d+)$`)

type SheetName struct {
	SheetID int
	Name    string
}

// copyNames names `count` copies of `name` among `taken`, the names in the
// encounter: "Orc 1" and "Orc 2" go on as "Orc 3", "Orc 4"… A copy with none
// of its kind keeps the name. The one "Orc" goes on as "Orc 1" once copies
// join it: renumbered is its name then, else empty.
func copyNames(name string, taken []string, count int) (names []string, renumbered string) {
	base := name
	if m := numbered.FindStringSubmatch(name); m != nil {
		base = m[1]
	}
	last, bare := 0, 0
	for _, t := range taken {
		if t == base {
			bare++
		} else if m := numbered.FindStringSubmatch(t); m != nil && m[1] == base {
			n, _ := strconv.Atoi(m[2])
			last = max(last, n)
		}
	}
	if last == 0 && bare == 0 && count == 1 {
		return []string{name}, ""
	}
	if bare == 1 && !slices.Contains(taken, base+" 1") {
		renumbered = base
	}
	if bare > 0 {
		last = max(last, 1)
	}
	names = make([]string, count)
	for i := range names {
		names[i] = fmt.Sprintf("%s %d", base, last+1+i)
	}
	return names, renumbered
}

func (m *EncounterModel) Duplicate(ctx context.Context, ref EncounterRef, participantID, count int) (*EncounterState, error) {
	if count < 1 || count > maxDuplicates {
		return nil, ErrInvalidEncounterRequest
	}
	var renamed *SheetName
	state, err := m.mutate(ctx, ref, func(tx pgx.Tx) error {
		var sheetID int
		var displayName *string
		var name, side string
		err := tx.QueryRow(ctx, `
            SELECT p.sheet_id, p.display_name, cs.character_name, p.side::text
            FROM encounter_participants p
            JOIN character_sheets cs ON cs.id = p.sheet_id AND cs.encounter_id = p.encounter_id
            WHERE p.id = $1 AND p.encounter_id = $2`, participantID, ref.EncounterID).Scan(&sheetID, &displayName, &name, &side)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidEncounterRequest
		}
		if err != nil {
			return err
		}

		renamed, err = addCopies(ctx, tx, ref, sheetID, name, count, displayName, true, side)
		return err
	})
	if err != nil {
		return nil, err
	}
	state.Renamed = renamed
	return state, nil
}

// addCopies adds `count` copies of sheet srcID, numbered after `name` among
// the names in the encounter, each in a group of its own in column `side`,
// and returns the NPC it numbered along with them, if any. With sameSource
// the copies take the source of srcID rather than srcID itself: a duplicate
// of an NPC is of the NPC's creature, and stays so once the NPC is gone.
func addCopies(ctx context.Context, tx pgx.Tx, ref EncounterRef, srcID int, name string, count int, displayName *string, sameSource bool, side string) (*SheetName, error) {
	rows, err := tx.Query(ctx, `
        SELECT character_name FROM character_sheets WHERE encounter_id = $1`, ref.EncounterID)
	if err != nil {
		return nil, err
	}
	taken, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}

	names, renumbered := copyNames(name, taken, count)
	var renamed *SheetName
	if renumbered != "" {
		renamed = &SheetName{Name: renumbered + " 1"}
		err := tx.QueryRow(ctx, `
            UPDATE character_sheets
            SET content = jsonb_set(content, '{characterInfo,characterName}', to_jsonb($3::text)),
                version = version + 1, updated_at = now()
            WHERE encounter_id = $1 AND character_name = $2
            RETURNING id`, ref.EncounterID, renumbered, renamed.Name).Scan(&renamed.SheetID)
		if err != nil {
			return nil, err
		}
	}

	home := SheetHome{EncounterID: &ref.EncounterID}
	for _, copyName := range names {
		copyID, err := copySheet(ctx, tx, ref.UserID, srcID, home, copyName)
		if err != nil {
			return nil, err
		}
		if sameSource {
			_, err := tx.Exec(ctx, `
                UPDATE character_sheets c SET source_sheet_id = src.source_sheet_id, source_label = src.source_label
                FROM character_sheets src
                WHERE c.id = $1 AND src.id = $2`, copyID, srcID)
			if err != nil {
				return nil, err
			}
		}
		if err := addParticipant(ctx, tx, ref.EncounterID, copyID, displayName, side); err != nil {
			return nil, err
		}
	}
	return renamed, nil
}

func (m *EncounterModel) AddCreature(ctx context.Context, ref EncounterRef, creatureID, count int) (*EncounterState, error) {
	if count < 1 || count > maxDuplicates {
		return nil, ErrInvalidEncounterRequest
	}
	var renamed *SheetName
	state, err := m.mutate(ctx, ref, func(tx pgx.Tx) error {
		if err := viewCreature(ctx, tx, ref.UserID, creatureID); err != nil {
			return err
		}
		var name string
		err := tx.QueryRow(ctx, `SELECT character_name FROM character_sheets WHERE id = $1`, creatureID).Scan(&name)
		if err != nil {
			return err
		}
		renamed, err = addCopies(ctx, tx, ref, creatureID, name, count, nil, false, SideEnemies)
		return err
	})
	if err != nil {
		return nil, err
	}
	state.Renamed = renamed
	return state, nil
}

// turnOrder is the groups of the encounter and of the party of its room in the
// order they take turns.
func turnOrder(ctx context.Context, q querier, encounterID int) ([]int, error) {
	rows, err := q.Query(ctx, `
        SELECT g.id FROM initiative_groups g
        JOIN encounters e ON e.id = $1 AND (g.encounter_id = e.id OR g.room_id = e.room_id)
        LEFT JOIN initiative_positions ip ON ip.encounter_id = e.id AND ip.group_id = g.id
        ORDER BY ip.position NULLS LAST, g.id`, encounterID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[int])
}

func turn(ctx context.Context, q querier, encounterID int) (current *int, round int, err error) {
	err = q.QueryRow(ctx, `SELECT current_group_id, round FROM encounters WHERE id = $1`, encounterID).Scan(&current, &round)
	return current, round, err
}

func setTurn(ctx context.Context, q querier, encounterID int, current *int, round int) error {
	_, err := q.Exec(ctx, `UPDATE encounters SET current_group_id = $2, round = $3 WHERE id = $1`, encounterID, current, round)
	return err
}

// dropEmptyGroups removes the groups of the encounter and of the party of its
// room left without participants and returns them.
func dropEmptyGroups(ctx context.Context, q querier, encounterID int) ([]int, error) {
	rows, err := q.Query(ctx, `
        DELETE FROM initiative_groups g
        USING encounters e
        WHERE e.id = $1 AND (g.encounter_id = e.id OR g.room_id = e.room_id)
          AND NOT EXISTS (SELECT 1 FROM encounter_participants p WHERE p.group_id = g.id)
        RETURNING g.id`, encounterID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[int])
}

// turnBefore is the turn of an encounter and its order before groups go.
type turnBefore struct {
	encounterID int
	current     *int
	round       int
	order       []int
}

func turnsOf(ctx context.Context, q querier, encounterIDs []int) ([]turnBefore, error) {
	turns := make([]turnBefore, len(encounterIDs))
	for i, id := range encounterIDs {
		t := &turns[i]
		t.encounterID = id
		var err error
		if t.current, t.round, err = turn(ctx, q, id); err != nil {
			return nil, err
		}
		if t.order, err = turnOrder(ctx, q, id); err != nil {
			return nil, err
		}
	}
	return turns, nil
}

// passTurns ends the turn of each encounter whose current group is among the
// `gone`: the turn goes to the next group as with "Next", after the last one
// to the first in the next round, and to none when no group is left.
func passTurns(ctx context.Context, q querier, turns []turnBefore, gone []int) error {
	left := func(id int) bool { return !slices.Contains(gone, id) }
	for _, t := range turns {
		if t.current == nil || left(*t.current) {
			continue
		}
		i := slices.Index(t.order, *t.current)
		var err error
		if j := slices.IndexFunc(t.order[i+1:], left); j >= 0 {
			err = setTurn(ctx, q, t.encounterID, &t.order[i+1+j], t.round)
		} else if j := slices.IndexFunc(t.order, left); j >= 0 {
			err = setTurn(ctx, q, t.encounterID, &t.order[j], t.round+1)
		} else {
			err = setTurn(ctx, q, t.encounterID, nil, t.round)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// roomEncounters is the encounters of the room, in the order they are locked
// so that two transactions cannot wait for each other.
func roomEncounters(ctx context.Context, q querier, roomID int, lock bool) ([]int, error) {
	sql := `SELECT id FROM encounters WHERE room_id = $1 ORDER BY id`
	if lock {
		sql += ` FOR UPDATE`
	}
	rows, err := q.Query(ctx, sql, roomID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[int])
}

// removeParticipants takes the participants out of the encounter, or out of
// the party of its room and so out of all its encounters, and drops the groups
// they leave empty. Each of `encounters` whose current group goes passes the
// turn on. They must be locked.
func removeParticipants(ctx context.Context, tx pgx.Tx, ref EncounterRef, encounters []int, participantIDs []int) error {
	turns, err := turnsOf(ctx, tx, encounters)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
        DELETE FROM encounter_participants
        WHERE id = ANY($3) AND (encounter_id = $1 OR room_id = $2)`, ref.EncounterID, ref.RoomID, participantIDs)
	if err != nil {
		return err
	}
	gone, err := dropEmptyGroups(ctx, tx, ref.EncounterID)
	if err != nil {
		return err
	}
	return passTurns(ctx, tx, turns, gone)
}

// removeSheetFromEncounters takes a sheet of a room that is being deleted out
// of the party of the room and returns the encounters of the room it was in.
func removeSheetFromEncounters(ctx context.Context, tx pgx.Tx, sheetID int) ([]int, error) {
	var participantID, groupID, roomID int
	err := tx.QueryRow(ctx, `
        SELECT id, group_id, room_id FROM encounter_participants
        WHERE sheet_id = $1 AND room_id IS NOT NULL`, sheetID).Scan(&participantID, &groupID, &roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	encounters, err := roomEncounters(ctx, tx, roomID, true)
	if err != nil {
		return nil, err
	}
	turns, err := turnsOf(ctx, tx, encounters)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM encounter_participants WHERE id = $1`, participantID); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `
        DELETE FROM initiative_groups g
        WHERE g.id = $1 AND NOT EXISTS (SELECT 1 FROM encounter_participants p WHERE p.group_id = g.id)
        RETURNING g.id`, groupID)
	if err != nil {
		return nil, err
	}
	gone, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		return nil, err
	}
	if err := passTurns(ctx, tx, turns, gone); err != nil {
		return nil, err
	}
	// The views still have the sheet's row, and only the gamemaster's client
	// can count a new one: until it does, the players see no order rather
	// than a wrong one.
	_, err = tx.Exec(ctx, `
        UPDATE encounters SET initiative_view = NULL, version = version + 1, updated_at = now()
        WHERE id = ANY($1)`, encounters)
	if err != nil {
		return nil, err
	}
	return encounters, nil
}

// member is a participant as a change of its group or column sees it.
type member struct {
	side    string
	groupID int
}

// participantsOf returns the participants among `ids`, of the party of ref's
// room with `party`, else of its encounter; ErrInvalidEncounterRequest if any
// is not there.
func participantsOf(ctx context.Context, q querier, ref EncounterRef, party bool, ids []int) (map[int]member, error) {
	rows, err := q.Query(ctx, `
        SELECT id, side::text, group_id FROM encounter_participants
        WHERE id = ANY($3) AND CASE WHEN $4 THEN room_id = $2 ELSE encounter_id = $1 END`,
		ref.EncounterID, ref.RoomID, ids, party)
	if err != nil {
		return nil, err
	}
	members := map[int]member{}
	var id int
	var p member
	_, err = pgx.ForEachRow(rows, []any{&id, &p.side, &p.groupID}, func() error {
		members[id] = p
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if _, ok := members[id]; !ok {
			return nil, ErrInvalidEncounterRequest
		}
	}
	return members, nil
}

func (m *EncounterModel) Remove(ctx context.Context, ref EncounterRef, participantIDs []int) (*EncountersChange, error) {
	if len(participantIDs) == 0 {
		return nil, ErrInvalidEncounterRequest
	}
	party, err := partyOf(ctx, m.DB, participantIDs)
	if err != nil {
		return nil, err
	}
	return m.mutateIn(ctx, ref, party, func(tx pgx.Tx, encounters []int) error {
		if _, err := participantsOf(ctx, tx, ref, party, participantIDs); err != nil {
			return err
		}
		if party {
			if err := removeParticipants(ctx, tx, ref, encounters, participantIDs); err != nil {
				return err
			}
			return resetViews(ctx, tx, encounters)
		}
		// An NPC lives in its encounter: out of it, it is gone.
		rows, err := tx.Query(ctx, `
            SELECT p.sheet_id FROM encounter_participants p
            JOIN character_sheets cs ON cs.id = p.sheet_id AND cs.encounter_id = p.encounter_id
            WHERE p.encounter_id = $1 AND p.id = ANY($2)`, ref.EncounterID, participantIDs)
		if err != nil {
			return err
		}
		npcs, err := pgx.CollectRows(rows, pgx.RowTo[int])
		if err != nil {
			return err
		}
		if err := removeParticipants(ctx, tx, ref, encounters, participantIDs); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM character_sheets WHERE id = ANY($1) AND encounter_id = $2`, npcs, ref.EncounterID)
		return err
	})
}

// Move of a character changes its column in every encounter of the room. The
// views stay: a column is not in them, and a group the participant leaves
// changes only the open encounter's, which the gamemaster's client publishes
// again; the others the players see only once the gamemaster opens them.
func (m *EncounterModel) Move(ctx context.Context, ref EncounterRef, participantID int, side string) (*EncountersChange, error) {
	if side != SideParty && side != SideEnemies {
		return nil, ErrInvalidEncounterRequest
	}
	party, err := partyOf(ctx, m.DB, []int{participantID})
	if err != nil {
		return nil, err
	}
	return m.mutateIn(ctx, ref, party, func(tx pgx.Tx, _ []int) error {
		members, err := participantsOf(ctx, tx, ref, party, []int{participantID})
		if err != nil {
			return err
		}
		p := members[participantID]
		if p.side == side {
			return nil
		}
		var shared bool
		err = tx.QueryRow(ctx, `
            SELECT EXISTS (SELECT 1 FROM encounter_participants WHERE group_id = $1 AND id <> $2)`,
			p.groupID, participantID).Scan(&shared)
		if err != nil {
			return err
		}
		// A group is of one column: the participant leaves the others and
		// their turn, in a group of its own at their place.
		groupID := p.groupID
		if shared {
			if groupID, err = groupAt(ctx, tx, ref, party, nil, []int{p.groupID}); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE encounter_participants SET side = $2, group_id = $3 WHERE id = $1`, participantID, side, groupID)
		return err
	})
}

// SetDisplayName of a character names it so in every encounter of the room.
func (m *EncounterModel) SetDisplayName(ctx context.Context, ref EncounterRef, participantID int, name string) (*EncountersChange, error) {
	name, ok := cleanName(name, maxDisplayName, true)
	if !ok {
		return nil, ErrInvalidEncounterRequest
	}
	var displayName *string
	if name != "" {
		displayName = &name
	}
	party, err := partyOf(ctx, m.DB, []int{participantID})
	if err != nil {
		return nil, err
	}
	return m.mutateIn(ctx, ref, party, func(tx pgx.Tx, _ []int) error {
		if _, err := participantsOf(ctx, tx, ref, party, []int{participantID}); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE encounter_participants SET display_name = $2 WHERE id = $1`, participantID, displayName)
		return err
	})
}

func (m *EncounterModel) Group(ctx context.Context, ref EncounterRef, participantIDs []int, name string) (*EncountersChange, error) {
	name, ok := cleanName(name, maxEncounterName, true)
	if !ok {
		return nil, ErrInvalidEncounterRequest
	}
	var groupName *string
	if name != "" {
		groupName = &name
	}
	participantIDs = slices.Compact(slices.Sorted(slices.Values(participantIDs)))
	if len(participantIDs) < 2 {
		return nil, ErrInvalidEncounterRequest
	}
	party, err := partyOf(ctx, m.DB, participantIDs)
	if err != nil {
		return nil, err
	}
	return m.mutateIn(ctx, ref, party, func(tx pgx.Tx, encounters []int) error {
		members, err := participantsOf(ctx, tx, ref, party, participantIDs)
		if err != nil {
			return err
		}
		// A group is of one home and one column.
		side := members[participantIDs[0]].side
		var groups []int
		for _, id := range participantIDs {
			if members[id].side != side {
				return ErrInvalidEncounterRequest
			}
			groups = append(groups, members[id].groupID)
		}
		turns, err := turnsOf(ctx, tx, encounters)
		if err != nil {
			return err
		}

		groupID, err := groupAt(ctx, tx, ref, party, groupName, groups)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE encounter_participants SET group_id = $2 WHERE id = ANY($1)`, participantIDs, groupID); err != nil {
			return err
		}
		gone, err := dropEmptyGroups(ctx, tx, ref.EncounterID)
		if err != nil {
			return err
		}
		// Where it was the turn of those grouped, they take it on in their
		// new group.
		for _, t := range turns {
			if t.current != nil && slices.Contains(gone, *t.current) {
				if err := setTurn(ctx, tx, t.encounterID, &groupID, t.round); err != nil {
					return err
				}
			}
		}
		if party {
			return resetViews(ctx, tx, encounters)
		}
		return nil
	})
}

func (m *EncounterModel) Ungroup(ctx context.Context, ref EncounterRef, groupID int) (*EncountersChange, error) {
	var party bool
	err := m.DB.QueryRow(ctx, `
        SELECT COALESCE(bool_or(room_id IS NOT NULL), false) FROM initiative_groups WHERE id = $1`, groupID).Scan(&party)
	if err != nil {
		return nil, err
	}
	return m.mutateIn(ctx, ref, party, func(tx pgx.Tx, encounters []int) error {
		rows, err := tx.Query(ctx, `
            SELECT p.id FROM encounter_participants p
            JOIN initiative_groups g ON g.id = p.group_id
            WHERE g.id = $1 AND CASE WHEN $4 THEN g.room_id = $3 ELSE g.encounter_id = $2 END
            ORDER BY p.id`, groupID, ref.EncounterID, ref.RoomID, party)
		if err != nil {
			return err
		}
		members, err := pgx.CollectRows(rows, pgx.RowTo[int])
		if err != nil {
			return err
		}
		if len(members) == 0 {
			return ErrInvalidEncounterRequest
		}
		// The first member keeps the group, and with it the turn where it had
		// it; the others follow it in groups of their own.
		if _, err := tx.Exec(ctx, `UPDATE initiative_groups SET name = NULL WHERE id = $1`, groupID); err != nil {
			return err
		}
		for _, participantID := range members[1:] {
			own, err := groupAt(ctx, tx, ref, party, nil, []int{groupID})
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE encounter_participants SET group_id = $2 WHERE id = $1`, participantID, own); err != nil {
				return err
			}
		}
		if party && len(members) > 1 {
			return resetViews(ctx, tx, encounters)
		}
		return nil
	})
}

func (m *EncounterModel) Order(ctx context.Context, ref EncounterRef, positions map[int]int, view *InitiativeView) (*EncounterState, error) {
	encoded, err := json.Marshal(view)
	if err != nil {
		return nil, err
	}
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		// A group gone since the client sorted is no longer here to move; a
		// group of the party moves in this encounter only.
		for groupID, position := range positions {
			_, err := tx.Exec(ctx, `
                INSERT INTO initiative_positions (encounter_id, group_id, position)
                SELECT $1, g.id, $4 FROM initiative_groups g
                WHERE g.id = $3 AND (g.encounter_id = $1 OR g.room_id = $2)
                ON CONFLICT (encounter_id, group_id) DO UPDATE SET position = EXCLUDED.position`,
				ref.EncounterID, ref.RoomID, groupID, position)
			if err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `UPDATE encounters SET initiative_view = $2 WHERE id = $1`, ref.EncounterID, encoded)
		return err
	})
}

func (m *EncounterModel) DropView(ctx context.Context, ref EncounterRef) (*EncounterState, error) {
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		return resetViews(ctx, tx, []int{ref.EncounterID})
	})
}

func (m *EncounterModel) Next(ctx context.Context, ref EncounterRef) (*EncounterState, error) {
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		current, round, err := turn(ctx, tx, ref.EncounterID)
		if err != nil {
			return err
		}
		order, err := turnOrder(ctx, tx, ref.EncounterID)
		if err != nil || len(order) == 0 {
			return err
		}
		// The first "Next" starts the round; after the last group the next begins.
		i := -1
		if current != nil {
			i = slices.Index(order, *current)
		}
		if i == len(order)-1 {
			return setTurn(ctx, tx, ref.EncounterID, &order[0], round+1)
		}
		return setTurn(ctx, tx, ref.EncounterID, &order[i+1], round)
	})
}

func (m *EncounterModel) Prev(ctx context.Context, ref EncounterRef) (*EncounterState, error) {
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		current, round, err := turn(ctx, tx, ref.EncounterID)
		if err != nil || current == nil {
			return err
		}
		order, err := turnOrder(ctx, tx, ref.EncounterID)
		if err != nil {
			return err
		}
		switch i := slices.Index(order, *current); {
		case i > 0:
			return setTurn(ctx, tx, ref.EncounterID, &order[i-1], round)
		case i == 0 && round > 1:
			return setTurn(ctx, tx, ref.EncounterID, &order[len(order)-1], round-1)
		case i == 0:
			return setTurn(ctx, tx, ref.EncounterID, nil, 1)
		}
		// The current group is no longer in the order: there is no turn before it.
		return nil
	})
}

func (m *EncounterModel) ResetInitiative(ctx context.Context, ref EncounterRef) (*EncounterState, error) {
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		return setTurn(ctx, tx, ref.EncounterID, nil, 1)
	})
}

func (m *EncounterModel) CheckNpcs(ctx context.Context, ref EncounterRef, sheetIDs []int) error {
	if len(sheetIDs) == 0 {
		return ErrInvalidEncounterRequest
	}
	unique := slices.Compact(slices.Sorted(slices.Values(sheetIDs)))
	var gm bool
	var npcs int
	err := m.DB.QueryRow(ctx, `
        SELECT
            EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = e.room_id AND rm.user_id = $2 AND rm.role = 'gamemaster'),
            (SELECT count(*) FROM character_sheets cs WHERE cs.encounter_id = e.id AND cs.id = ANY($3))
        FROM encounters e
        WHERE e.id = $1 AND e.room_id = $4`, ref.EncounterID, ref.UserID, unique, ref.RoomID).Scan(&gm, &npcs)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !gm) {
		return ErrPermissionDenied
	}
	if err != nil {
		return err
	}
	if npcs != len(unique) {
		return ErrInvalidEncounterRequest
	}
	return nil
}
