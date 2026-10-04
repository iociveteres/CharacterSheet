package models

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// The file of an encounter: its NPCs and their groups, exported and loaded
// back as a new encounter or in place of the NPCs of one
// (_prd/gm_mode/data-model.md, "Файл энкаунтера"). Characters are not in it:
// the gamemaster adds them with "Add sheets".

const (
	EncounterFileFormat  = "encounter"
	EncounterFileVersion = 1
	// A source label is "collection · owner", as copySheet writes it.
	maxSourceLabel = 300
	// Far below the INT column, which "Next" goes on counting from it.
	maxFileRound = 10000
)

type EncounterFile struct {
	Format  string `json:"format"`
	Version int    `json:"version"`
	Name    string `json:"name"`
	Round   int    `json:"round"`
	// Groups are in turn order.
	Groups []GroupInFile `json:"groups"`
	Npcs   []NpcInFile   `json:"npcs"`
}

// GroupInFile is a group of NPCs; Ref is what its NPCs name it by in the file.
type GroupInFile struct {
	Ref  string  `json:"ref"`
	Name *string `json:"name"`
}

// NpcInFile is an NPC with its content as in the export of a sheet, without
// the kind inside. Group is the ref of its group; an NPC without one gets a
// group of its own. SourceSheetID is the creature it was copied from: loaded,
// the NPC remembers it only when it is a creature of the loader.
type NpcInFile struct {
	Group         string          `json:"group"`
	DisplayName   *string         `json:"displayName"`
	SheetKind     SheetKind       `json:"sheetKind"`
	Content       json.RawMessage `json:"content"`
	SourceLabel   *string         `json:"sourceLabel"`
	SourceSheetID *int            `json:"sourceSheetId"`
}

// cleanOptional is an optional name of a file: trimmed, nil when empty.
func cleanOptional(name *string, max int) (*string, bool) {
	if name == nil {
		return nil, true
	}
	clean, ok := cleanName(*name, max, true)
	if !ok || clean == "" {
		return nil, ok
	}
	return &clean, true
}

// ParseEncounterFile reads and checks an encounter file. The names come out
// trimmed, the contents in the current shape; an empty name stays empty.
func ParseEncounterFile(data []byte) (*EncounterFile, error) {
	var f EncounterFile
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, ErrInvalidEncounterRequest
	}
	if f.Format != EncounterFileFormat || f.Version != EncounterFileVersion || f.Round < 1 || f.Round > maxFileRound ||
		len(f.Npcs) > maxInitiativeRows || len(f.Groups) > maxInitiativeRows {
		return nil, ErrInvalidEncounterRequest
	}
	var ok bool
	if f.Name, ok = cleanName(f.Name, maxEncounterName, true); !ok {
		return nil, ErrInvalidEncounterRequest
	}
	refs := map[string]bool{}
	for i, g := range f.Groups {
		if g.Ref == "" || refs[g.Ref] {
			return nil, ErrInvalidEncounterRequest
		}
		refs[g.Ref] = true
		if f.Groups[i].Name, ok = cleanOptional(g.Name, maxEncounterName); !ok {
			return nil, ErrInvalidEncounterRequest
		}
	}
	for i, n := range f.Npcs {
		npc := &f.Npcs[i]
		if n.Group != "" && !refs[n.Group] {
			return nil, ErrInvalidEncounterRequest
		}
		if npc.SheetKind, npc.Content, ok = sheetFromFile(n.SheetKind, n.Content); !ok {
			return nil, ErrInvalidEncounterRequest
		}
		if npc.DisplayName, ok = cleanOptional(n.DisplayName, maxDisplayName); !ok {
			return nil, ErrInvalidEncounterRequest
		}
		if npc.SourceLabel, ok = cleanOptional(n.SourceLabel, maxSourceLabel); !ok {
			return nil, ErrInvalidEncounterRequest
		}
	}
	if f.Groups == nil {
		f.Groups = []GroupInFile{}
	}
	if f.Npcs == nil {
		f.Npcs = []NpcInFile{}
	}
	return &f, nil
}

func (m *EncounterModel) Export(ctx context.Context, userID, encounterID int) (*EncounterFile, error) {
	// Get checks that the user is the gamemaster of the encounter's room.
	state, err := m.Get(ctx, userID, encounterID)
	if err != nil {
		return nil, err
	}
	f := &EncounterFile{
		Format: EncounterFileFormat, Version: EncounterFileVersion, Name: state.Name, Round: state.Round,
		Groups: []GroupInFile{}, Npcs: []NpcInFile{},
	}

	// The groups of NPCs only: a group is of one column.
	rows, err := m.DB.Query(ctx, `
        SELECT g.id, g.name FROM initiative_groups g
        WHERE g.encounter_id = $1
          AND EXISTS (
              SELECT 1 FROM encounter_participants p
              JOIN character_sheets cs ON cs.id = p.sheet_id AND cs.encounter_id = p.encounter_id
              WHERE p.group_id = g.id)
        ORDER BY g.position, g.id`, encounterID)
	if err != nil {
		return nil, err
	}
	refs := map[int]string{}
	f.Groups, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (GroupInFile, error) {
		var id int
		g := GroupInFile{Ref: fmt.Sprintf("g%d", len(refs)+1)}
		if err := row.Scan(&id, &g.Name); err != nil {
			return g, err
		}
		refs[id] = g.Ref
		return g, nil
	})
	if err != nil {
		return nil, err
	}

	// The initiative is not the file's: it is rolled anew.
	rows, err = m.DB.Query(ctx, `
        SELECT p.group_id, p.display_name, cs.sheet_kind, jsonb_set(cs.content, '`+lastInitiativePath+`', '0'),
               cs.source_label, CASE WHEN src.collection_id IS NOT NULL THEN src.id END
        FROM encounter_participants p
        JOIN character_sheets cs ON cs.id = p.sheet_id AND cs.encounter_id = p.encounter_id
        JOIN initiative_groups g ON g.id = p.group_id
        LEFT JOIN character_sheets src ON src.id = cs.source_sheet_id
        WHERE p.encounter_id = $1
        ORDER BY g.position, g.id, p.id`, encounterID)
	if err != nil {
		return nil, err
	}
	f.Npcs, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (NpcInFile, error) {
		var n NpcInFile
		var groupID int
		err := row.Scan(&groupID, &n.DisplayName, &n.SheetKind, &n.Content, &n.SourceLabel, &n.SourceSheetID)
		n.Group = refs[groupID]
		return n, err
	})
	if err != nil {
		return nil, err
	}
	return f, nil
}

// insertNpcs adds the NPCs of file f, which ParseEncounterFile read, to the
// encounter as sheets of userID, within the quota, their groups after those
// it has. An NPC remembers its source only when it is a creature of userID's.
func insertNpcs(ctx context.Context, tx pgx.Tx, userID, encounterID int, f *EncounterFile) error {
	sources := []int{}
	for _, n := range f.Npcs {
		if n.SourceSheetID != nil {
			sources = append(sources, *n.SourceSheetID)
		}
	}
	rows, err := tx.Query(ctx, `
        SELECT cs.id FROM character_sheets cs
        JOIN bestiary_collections c ON c.id = cs.collection_id
        WHERE cs.id = ANY($1) AND c.owner_id = $2`, sources, userID)
	if err != nil {
		return err
	}
	ownList, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		return err
	}
	own := map[int]bool{}
	for _, id := range ownList {
		own[id] = true
	}

	before, err := lockQuota(ctx, tx, userID)
	if err != nil {
		return err
	}
	var next int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(position), -1) + 1 FROM initiative_groups WHERE encounter_id = $1`, encounterID).Scan(&next); err != nil {
		return err
	}
	newGroup := func(name *string) (int, error) {
		var id int
		err := tx.QueryRow(ctx, `INSERT INTO initiative_groups (encounter_id, position, name) VALUES ($1, $2, $3) RETURNING id`,
			encounterID, next, name).Scan(&id)
		next++
		return id, err
	}
	groups := map[string]int{}
	for _, g := range f.Groups {
		if groups[g.Ref], err = newGroup(g.Name); err != nil {
			return err
		}
	}

	for _, n := range f.Npcs {
		groupID, ok := groups[n.Group]
		if !ok {
			if groupID, err = newGroup(nil); err != nil {
				return err
			}
		}
		var source *int
		if n.SourceSheetID != nil && own[*n.SourceSheetID] {
			source = n.SourceSheetID
		}
		var sheetID int
		err := tx.QueryRow(ctx, `
            INSERT INTO character_sheets (owner_id, encounter_id, sheet_kind, content, source_sheet_id, source_label, created_at, updated_at)
            VALUES ($1, $2, $3, jsonb_set($4::jsonb, '`+lastInitiativePath+`', '0'), $5, $6, now(), now())
            RETURNING id`, userID, encounterID, n.SheetKind, n.Content, source, n.SourceLabel).Scan(&sheetID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
            INSERT INTO encounter_participants (encounter_id, group_id, sheet_id, display_name)
            VALUES ($1, $2, $3, $4)`, encounterID, groupID, sheetID, n.DisplayName)
		if err != nil {
			return err
		}
	}
	if err := checkQuota(ctx, tx, userID, before); err != nil {
		return err
	}
	// A group of the file none of its NPCs is in.
	_, err = dropEmptyGroups(ctx, tx, encounterID)
	return err
}

// Load makes a new encounter of the room from file f, which
// ParseEncounterFile read: not shown, in the file's round with no turn.
func (m *EncounterModel) Load(ctx context.Context, userID, roomID int, f *EncounterFile) (*EncounterState, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	gm, err := isGamemaster(ctx, tx, userID, roomID)
	if err != nil {
		return nil, err
	}
	if !gm {
		return nil, ErrPermissionDenied
	}
	// A file without a name is named as "New encounter" names one.
	name := f.Name
	if name == "" {
		var count int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM encounters WHERE room_id = $1`, roomID).Scan(&count); err != nil {
			return nil, err
		}
		name = fmt.Sprintf("Encounter %d", count+1)
	}
	var id int
	err = tx.QueryRow(ctx, `INSERT INTO encounters (room_id, name, round) VALUES ($1, $2, $3) RETURNING id`, roomID, name, f.Round).Scan(&id)
	if err != nil {
		return nil, err
	}
	if err := insertNpcs(ctx, tx, userID, id, f); err != nil {
		return nil, err
	}
	state, err := loadEncounter(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	return state, tx.Commit(ctx)
}

// ReplaceNpcs puts the NPCs of file f, which ParseEncounterFile read, in place
// of those of the encounter; its characters and their groups stay. The
// encounter takes the file's round with no turn, and the players see no order
// until the gamemaster's client publishes the new one.
func (m *EncounterModel) ReplaceNpcs(ctx context.Context, ref EncounterRef, f *EncounterFile) (*EncounterState, error) {
	return m.mutate(ctx, ref, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
            SELECT p.id, p.sheet_id FROM encounter_participants p
            JOIN character_sheets cs ON cs.id = p.sheet_id AND cs.encounter_id = p.encounter_id
            WHERE p.encounter_id = $1`, ref.EncounterID)
		if err != nil {
			return err
		}
		var participantID, sheetID int
		var participants, npcs []int
		_, err = pgx.ForEachRow(rows, []any{&participantID, &sheetID}, func() error {
			participants = append(participants, participantID)
			npcs = append(npcs, sheetID)
			return nil
		})
		if err != nil {
			return err
		}
		if err := removeParticipants(ctx, tx, ref.EncounterID, participants); err != nil {
			return err
		}
		// Gone before the quota is counted: the file takes the place they free.
		if _, err := tx.Exec(ctx, `DELETE FROM character_sheets WHERE id = ANY($1) AND encounter_id = $2`, npcs, ref.EncounterID); err != nil {
			return err
		}
		if err := insertNpcs(ctx, tx, ref.UserID, ref.EncounterID, f); err != nil {
			return err
		}
		// The view has the rows of the old NPCs.
		_, err = tx.Exec(ctx, `
            UPDATE encounters SET round = $2, current_group_id = NULL, initiative_view = NULL
            WHERE id = $1`, ref.EncounterID, f.Round)
		return err
	})
}
