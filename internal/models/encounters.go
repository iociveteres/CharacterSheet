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

	AddSheets(ctx context.Context, ref EncounterRef, sheetIDs []int) (*EncounterState, error)
	NewNpc(ctx context.Context, ref EncounterRef, kind SheetKind) (*EncounterState, error)
	Duplicate(ctx context.Context, ref EncounterRef, participantID, count int) (*EncounterState, error)
	Remove(ctx context.Context, ref EncounterRef, participantIDs []int) (*EncounterState, error)
	SetDisplayName(ctx context.Context, ref EncounterRef, participantID int, name string) (*EncounterState, error)
	Group(ctx context.Context, ref EncounterRef, participantIDs []int, name string) (*EncounterState, error)
	Ungroup(ctx context.Context, ref EncounterRef, groupID int) (*EncounterState, error)
	// Order stores the positions of groups the gamemaster's client sorted
	// and the view it made of them.
	Order(ctx context.Context, ref EncounterRef, positions map[int]int, view *InitiativeView) (*EncounterState, error)
	Next(ctx context.Context, ref EncounterRef) (*EncounterState, error)
	ResetInitiative(ctx context.Context, ref EncounterRef) (*EncounterState, error)
	// CheckNpcs fails unless every sheet is an NPC of the encounter.
	CheckNpcs(ctx context.Context, ref EncounterRef, sheetIDs []int) error
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
	maxEncounterName = 100
	maxDisplayName   = 100
	maxDuplicates    = 20
	newNpcName       = "New NPC"
)

type EncounterModel struct {
	DB *pgxpool.Pool
}

// cleanName trims a name the user typed; "" fails unless `empty` allows it.
func cleanName(name string, max int, empty bool) (string, error) {
	name = strings.TrimSpace(name)
	if (name == "" && !empty) || utf8.RuneCountInString(name) > max {
		return "", ErrInvalidEncounterRequest
	}
	return name, nil
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

func touch(ctx context.Context, q querier, encounterID int) error {
	_, err := q.Exec(ctx, `UPDATE encounters SET version = version + 1, updated_at = now() WHERE id = $1`, encounterID)
	return err
}

func loadEncounter(ctx context.Context, q querier, encounterID int) (*EncounterState, error) {
	s := &EncounterState{Groups: []EncounterGroup{}, Participants: []EncounterParticipant{}}
	var view []byte
	err := q.QueryRow(ctx, `
        SELECT e.id, e.room_id, e.name, e.round, e.current_group_id,
               r.shown_encounter_id IS NOT DISTINCT FROM e.id,
               e.initiative_view, e.version, e.updated_at
        FROM encounters e
        JOIN rooms r ON r.id = e.room_id
        WHERE e.id = $1`, encounterID).Scan(
		&s.ID, &s.RoomID, &s.Name, &s.Round, &s.CurrentGroupID, &s.Shown, &view, &s.Version, &s.UpdatedAt)
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
        SELECT id, position, name FROM initiative_groups
        WHERE encounter_id = $1
        ORDER BY position, id`, encounterID)
	if err != nil {
		return nil, err
	}
	s.Groups, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (EncounterGroup, error) {
		var g EncounterGroup
		return g, row.Scan(&g.ID, &g.Position, &g.Name)
	})
	if err != nil {
		return nil, err
	}

	rows, err = q.Query(ctx, `
        SELECT p.id, p.group_id, p.sheet_id, p.display_name,
               cs.encounter_id IS NOT NULL,
               COALESCE(cs.content->'characterInfo'->>'characterName', '')
        FROM encounter_participants p
        JOIN character_sheets cs ON cs.id = p.sheet_id
        WHERE p.encounter_id = $1
        ORDER BY p.id`, encounterID)
	if err != nil {
		return nil, err
	}
	s.Participants, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (EncounterParticipant, error) {
		var p EncounterParticipant
		return p, row.Scan(&p.ID, &p.GroupID, &p.SheetID, &p.DisplayName, &p.NPC, &p.Name)
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
	var view []byte
	err := m.DB.QueryRow(ctx, `
        SELECT e.initiative_view
        FROM rooms r
        JOIN encounters e ON e.id = r.shown_encounter_id
        WHERE r.id = $1`, roomID).Scan(&view)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && view == nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var v InitiativeView
	return &v, json.Unmarshal(view, &v)
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
	name, err := cleanName(name, maxEncounterName, false)
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
	var id int
	if err := m.DB.QueryRow(ctx, `INSERT INTO encounters (room_id, name) VALUES ($1, $2) RETURNING id`, roomID, name).Scan(&id); err != nil {
		return nil, err
	}
	return loadEncounter(ctx, m.DB, id)
}

func (m *EncounterModel) Rename(ctx context.Context, ref EncounterRef, name string) (*EncounterState, error) {
	name, err := cleanName(name, maxEncounterName, false)
	if err != nil {
		return nil, err
	}
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE encounters SET name = $2 WHERE id = $1`, ref.EncounterID, name)
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

// addParticipant puts the sheet into the encounter in a group of its own,
// last in the turn order until the gamemaster's client sorts it.
func addParticipant(ctx context.Context, q querier, encounterID, sheetID int, displayName *string) error {
	var groupID int
	err := q.QueryRow(ctx, `
        INSERT INTO initiative_groups (encounter_id, position)
        SELECT $1, COALESCE(MAX(position), -1) + 1 FROM initiative_groups WHERE encounter_id = $1
        RETURNING id`, encounterID).Scan(&groupID)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `
        INSERT INTO encounter_participants (encounter_id, group_id, sheet_id, display_name)
        VALUES ($1, $2, $3, $4)`, encounterID, groupID, sheetID, displayName)
	return err
}

func (m *EncounterModel) AddSheets(ctx context.Context, ref EncounterRef, sheetIDs []int) (*EncounterState, error) {
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		for _, sheetID := range sheetIDs {
			// Only the sheets of the encounter's room: the gamemaster sees them all.
			var inRoom, added bool
			err := tx.QueryRow(ctx, `
                SELECT cs.room_id = e.room_id,
                       EXISTS (SELECT 1 FROM encounter_participants p WHERE p.encounter_id = e.id AND p.sheet_id = cs.id)
                FROM character_sheets cs, encounters e
                WHERE cs.id = $1 AND e.id = $2`, sheetID, ref.EncounterID).Scan(&inRoom, &added)
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && !inRoom) {
				return ErrInvalidEncounterRequest
			}
			if err != nil {
				return err
			}
			if added {
				continue
			}
			if err := addParticipant(ctx, tx, ref.EncounterID, sheetID, nil); err != nil {
				return err
			}
		}
		return nil
	})
}

func (m *EncounterModel) NewNpc(ctx context.Context, ref EncounterRef, kind SheetKind) (*EncounterState, error) {
	if !kind.IsValid() {
		return nil, ErrInvalidEncounterRequest
	}
	content, err := currentShape(json.RawMessage(defaultContent), kind)
	if err != nil {
		return nil, err
	}
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		if err := checkQuota(ctx, tx, ref.UserID, int64(len(content))); err != nil {
			return err
		}
		var sheetID int
		err := tx.QueryRow(ctx, `
            INSERT INTO character_sheets (owner_id, encounter_id, sheet_kind, content, created_at, updated_at)
            VALUES ($1, $2, $3, jsonb_set($4::jsonb, '{characterInfo,characterName}', to_jsonb($5::text)), now(), now())
            RETURNING id`, ref.UserID, ref.EncounterID, kind, content, newNpcName).Scan(&sheetID)
		if err != nil {
			return err
		}
		return addParticipant(ctx, tx, ref.EncounterID, sheetID, nil)
	})
}

var numbered = regexp.MustCompile(`^(.*?) (\d+)$`)

// copyNames names `count` copies of `name` among `taken`, the names in the
// encounter: "Orc" and "Orc 1" go on as "Orc 2", "Orc 3"…
func copyNames(name string, taken []string, count int) []string {
	base := name
	if m := numbered.FindStringSubmatch(name); m != nil {
		base = m[1]
	}
	last := 0
	for _, t := range taken {
		if t == base {
			last = max(last, 1)
		} else if m := numbered.FindStringSubmatch(t); m != nil && m[1] == base {
			n, _ := strconv.Atoi(m[2])
			last = max(last, n)
		}
	}
	names := make([]string, count)
	for i := range names {
		names[i] = fmt.Sprintf("%s %d", base, last+1+i)
	}
	return names
}

func (m *EncounterModel) Duplicate(ctx context.Context, ref EncounterRef, participantID, count int) (*EncounterState, error) {
	if count < 1 || count > maxDuplicates {
		return nil, ErrInvalidEncounterRequest
	}
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		var sheetID int
		var displayName *string
		var name string
		err := tx.QueryRow(ctx, `
            SELECT p.sheet_id, p.display_name, COALESCE(cs.content->'characterInfo'->>'characterName', '')
            FROM encounter_participants p
            JOIN character_sheets cs ON cs.id = p.sheet_id AND cs.encounter_id = p.encounter_id
            WHERE p.id = $1 AND p.encounter_id = $2`, participantID, ref.EncounterID).Scan(&sheetID, &displayName, &name)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidEncounterRequest
		}
		if err != nil {
			return err
		}

		rows, err := tx.Query(ctx, `
            SELECT COALESCE(content->'characterInfo'->>'characterName', '')
            FROM character_sheets WHERE encounter_id = $1`, ref.EncounterID)
		if err != nil {
			return err
		}
		taken, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}

		home := SheetHome{EncounterID: &ref.EncounterID}
		for _, copyName := range copyNames(name, taken, count) {
			copyID, err := copySheet(ctx, tx, ref.UserID, sheetID, home, copyName)
			if err != nil {
				return err
			}
			if err := addParticipant(ctx, tx, ref.EncounterID, copyID, displayName); err != nil {
				return err
			}
		}
		return nil
	})
}

// turnOrder is the groups of the encounter in the order they take turns.
func turnOrder(ctx context.Context, q querier, encounterID int) ([]int, error) {
	rows, err := q.Query(ctx, `SELECT id FROM initiative_groups WHERE encounter_id = $1 ORDER BY position, id`, encounterID)
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

// dropEmptyGroups removes the groups of the encounter left without
// participants and returns them.
func dropEmptyGroups(ctx context.Context, q querier, encounterID int) ([]int, error) {
	rows, err := q.Query(ctx, `
        DELETE FROM initiative_groups g
        WHERE g.encounter_id = $1
          AND NOT EXISTS (SELECT 1 FROM encounter_participants p WHERE p.group_id = g.id)
        RETURNING g.id`, encounterID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[int])
}

// removeParticipants takes the participants out of the encounter and drops
// the groups they leave empty. When the group whose turn it was goes, its
// turn is over: the turn goes to the next group as with "Next", after the
// last one to the first in the next round, and to none when no group is left.
// The encounter must be locked.
func removeParticipants(ctx context.Context, tx pgx.Tx, encounterID int, participantIDs []int) error {
	current, round, err := turn(ctx, tx, encounterID)
	if err != nil {
		return err
	}
	before, err := turnOrder(ctx, tx, encounterID)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM encounter_participants WHERE encounter_id = $1 AND id = ANY($2)`, encounterID, participantIDs); err != nil {
		return err
	}
	gone, err := dropEmptyGroups(ctx, tx, encounterID)
	if err != nil {
		return err
	}
	if current == nil || !slices.Contains(gone, *current) {
		return nil
	}

	// The next group of the old order still in the encounter, else the first.
	left := func(id int) bool { return !slices.Contains(gone, id) }
	i := slices.Index(before, *current)
	if j := slices.IndexFunc(before[i+1:], left); j >= 0 {
		return setTurn(ctx, tx, encounterID, &before[i+1+j], round)
	}
	if j := slices.IndexFunc(before, left); j >= 0 {
		return setTurn(ctx, tx, encounterID, &before[j], round+1)
	}
	return setTurn(ctx, tx, encounterID, nil, round)
}

// removeSheetFromEncounters takes a sheet of a room that is being deleted out
// of every encounter it is in and returns those encounters.
func removeSheetFromEncounters(ctx context.Context, tx pgx.Tx, sheetID int) ([]int, error) {
	// Locked in one order, so two deletions cannot wait for each other.
	rows, err := tx.Query(ctx, `
        SELECT e.id FROM encounters e
        WHERE EXISTS (SELECT 1 FROM encounter_participants p WHERE p.encounter_id = e.id AND p.sheet_id = $1)
        ORDER BY e.id
        FOR UPDATE`, sheetID)
	if err != nil {
		return nil, err
	}
	encounters, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		return nil, err
	}
	for _, encounterID := range encounters {
		var participantID int
		err := tx.QueryRow(ctx, `SELECT id FROM encounter_participants WHERE encounter_id = $1 AND sheet_id = $2`, encounterID, sheetID).Scan(&participantID)
		if err != nil {
			return nil, err
		}
		if err := removeParticipants(ctx, tx, encounterID, []int{participantID}); err != nil {
			return nil, err
		}
		if err := touch(ctx, tx, encounterID); err != nil {
			return nil, err
		}
	}
	return encounters, nil
}

// participantsOf returns the participants of the encounter among `ids` with
// whether each is an NPC; ErrInvalidEncounterRequest if any is not in it.
func participantsOf(ctx context.Context, q querier, encounterID int, ids []int) (map[int]bool, error) {
	rows, err := q.Query(ctx, `
        SELECT p.id, cs.encounter_id IS NOT NULL
        FROM encounter_participants p
        JOIN character_sheets cs ON cs.id = p.sheet_id
        WHERE p.encounter_id = $1 AND p.id = ANY($2)`, encounterID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	npc := map[int]bool{}
	for rows.Next() {
		var id int
		var isNpc bool
		if err := rows.Scan(&id, &isNpc); err != nil {
			return nil, err
		}
		npc[id] = isNpc
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, id := range ids {
		if _, ok := npc[id]; !ok {
			return nil, ErrInvalidEncounterRequest
		}
	}
	return npc, nil
}

func (m *EncounterModel) Remove(ctx context.Context, ref EncounterRef, participantIDs []int) (*EncounterState, error) {
	if len(participantIDs) == 0 {
		return nil, ErrInvalidEncounterRequest
	}
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		if _, err := participantsOf(ctx, tx, ref.EncounterID, participantIDs); err != nil {
			return err
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
		if err := removeParticipants(ctx, tx, ref.EncounterID, participantIDs); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM character_sheets WHERE id = ANY($1) AND encounter_id = $2`, npcs, ref.EncounterID)
		return err
	})
}

func (m *EncounterModel) SetDisplayName(ctx context.Context, ref EncounterRef, participantID int, name string) (*EncounterState, error) {
	name, err := cleanName(name, maxDisplayName, true)
	if err != nil {
		return nil, err
	}
	var displayName *string
	if name != "" {
		displayName = &name
	}
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE encounter_participants SET display_name = $3 WHERE id = $1 AND encounter_id = $2`,
			participantID, ref.EncounterID, displayName)
		if err == nil && tag.RowsAffected() == 0 {
			return ErrInvalidEncounterRequest
		}
		return err
	})
}

func (m *EncounterModel) Group(ctx context.Context, ref EncounterRef, participantIDs []int, name string) (*EncounterState, error) {
	name, err := cleanName(name, maxEncounterName, true)
	if err != nil {
		return nil, err
	}
	var groupName *string
	if name != "" {
		groupName = &name
	}
	participantIDs = slices.Compact(slices.Sorted(slices.Values(participantIDs)))
	if len(participantIDs) < 2 {
		return nil, ErrInvalidEncounterRequest
	}
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		npc, err := participantsOf(ctx, tx, ref.EncounterID, participantIDs)
		if err != nil {
			return err
		}
		// A group is of one column: characters or NPCs.
		for _, id := range participantIDs {
			if npc[id] != npc[participantIDs[0]] {
				return ErrInvalidEncounterRequest
			}
		}
		current, round, err := turn(ctx, tx, ref.EncounterID)
		if err != nil {
			return err
		}

		// The new group takes the place of the first of their groups.
		var groupID int
		err = tx.QueryRow(ctx, `
            INSERT INTO initiative_groups (encounter_id, position, name)
            SELECT $1, MIN(g.position), $3
            FROM initiative_groups g
            JOIN encounter_participants p ON p.group_id = g.id
            WHERE p.encounter_id = $1 AND p.id = ANY($2)
            RETURNING id`, ref.EncounterID, participantIDs, groupName).Scan(&groupID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE encounter_participants SET group_id = $3 WHERE encounter_id = $1 AND id = ANY($2)`,
			ref.EncounterID, participantIDs, groupID); err != nil {
			return err
		}
		gone, err := dropEmptyGroups(ctx, tx, ref.EncounterID)
		if err != nil {
			return err
		}
		// Those whose turn it was take it on in their new group.
		if current != nil && slices.Contains(gone, *current) {
			return setTurn(ctx, tx, ref.EncounterID, &groupID, round)
		}
		return nil
	})
}

func (m *EncounterModel) Ungroup(ctx context.Context, ref EncounterRef, groupID int) (*EncounterState, error) {
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		var position int
		err := tx.QueryRow(ctx, `SELECT position FROM initiative_groups WHERE id = $1 AND encounter_id = $2`, groupID, ref.EncounterID).Scan(&position)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidEncounterRequest
		}
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT id FROM encounter_participants WHERE group_id = $1 ORDER BY id`, groupID)
		if err != nil {
			return err
		}
		members, err := pgx.CollectRows(rows, pgx.RowTo[int])
		if err != nil {
			return err
		}
		// The first member keeps the group, and with it the turn if it had it;
		// the others follow it in groups of their own.
		if _, err := tx.Exec(ctx, `UPDATE initiative_groups SET name = NULL WHERE id = $1`, groupID); err != nil {
			return err
		}
		for _, participantID := range members[min(1, len(members)):] {
			var own int
			err := tx.QueryRow(ctx, `INSERT INTO initiative_groups (encounter_id, position) VALUES ($1, $2) RETURNING id`,
				ref.EncounterID, position).Scan(&own)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE encounter_participants SET group_id = $2 WHERE id = $1`, participantID, own); err != nil {
				return err
			}
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
		// A group gone since the client sorted is no longer here to move.
		for groupID, position := range positions {
			if _, err := tx.Exec(ctx, `UPDATE initiative_groups SET position = $3 WHERE id = $1 AND encounter_id = $2`,
				groupID, ref.EncounterID, position); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `UPDATE encounters SET initiative_view = $2 WHERE id = $1`, ref.EncounterID, encoded)
		return err
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
