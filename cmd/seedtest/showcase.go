package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"charactersheet.iociveteres.net/internal/models"
)

// The showcase of the landing slides (scripts/slides/record.mjs): its own user
// and room with the sheets of the fixtures, all of them in the party of an
// empty encounter, and the user's bestiary with the collection files of
// fixtures/collections, subscribed to those of fixtures/subscriptions, which
// another user publishes. Every run makes them anew and clears the chat, so
// that each take of a slide starts from the same state.
var (
	showcaseUser      = &seedUser{Key: "showcase", Name: "iociveteres", Email: "showcase@seed.test", Role: models.RoleGamemaster}
	showcasePublisher = &seedUser{Key: "publisher", Name: "KreVeDkoСnuB0M", Email: "publisher@seed.test"}
)

const (
	showcaseRoom      = "Round Table"
	showcaseEmptyRoom = "Camelot"
	showcaseEncounter = "Ambush at the Shrine"
)

type showcaseOutput struct {
	RoomID int `json:"roomId"`
	// A room with no sheets, for the slide that makes the first one.
	EmptyRoomID int       `json:"emptyRoomId"`
	Password    string    `json:"password"`
	User        *seedUser `json:"user"`
	// Sheet ids by fixture name: sir-galahad.json gives "sir-galahad".
	Sheets      map[string]int `json:"sheets"`
	EncounterID int            `json:"encounterId"`
	// Collection ids by name, the user's and those they subscribed to.
	Collections map[string]int `json:"collections"`
}

func seedShowcase(ctx context.Context, db *pgxpool.Pool, m models.Models, fixtures string) (*showcaseOutput, error) {
	files, err := filepath.Glob(filepath.Join(fixtures, "*.json"))
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no sheets in %s: put the exported showcase sheets there", fixtures)
	}
	sort.Strings(files)

	u := showcaseUser
	if u.ID, err = ensureUser(ctx, db, m, u); err != nil {
		return nil, fmt.Errorf("user %s: %w", u.Email, err)
	}

	roomID, err := emptyRoom(ctx, db, m, u.ID, showcaseRoom)
	if err != nil {
		return nil, err
	}
	emptyRoomID, err := emptyRoom(ctx, db, m, u.ID, showcaseEmptyRoom)
	if err != nil {
		return nil, err
	}

	sheets := map[string]int{}
	party := []int{}
	for _, file := range files {
		content, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		if !json.Valid(content) {
			return nil, fmt.Errorf("%s is not JSON", file)
		}
		id, err := m.CharacterSheets.InsertWithContent(ctx, u.ID, roomID, models.DefaultSheetKind, content)
		if err != nil {
			return nil, fmt.Errorf("sheet %s: %w", file, err)
		}
		sheets[strings.TrimSuffix(filepath.Base(file), ".json")] = id
		party = append(party, id)
	}

	encounter, err := m.Encounters.Create(ctx, u.ID, roomID, showcaseEncounter)
	if err != nil {
		return nil, fmt.Errorf("encounter: %w", err)
	}
	ref := models.EncounterRef{UserID: u.ID, RoomID: roomID, EncounterID: encounter.ID}
	if _, err := m.Encounters.PartyAdd(ctx, ref, party); err != nil {
		return nil, fmt.Errorf("party: %w", err)
	}

	collections, err := seedCollections(ctx, db, m, u.ID, filepath.Join(fixtures, "collections"))
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(ctx, `DELETE FROM bestiary_subscriptions WHERE user_id = $1`, u.ID); err != nil {
		return nil, err
	}
	p := showcasePublisher
	if p.ID, err = ensureUser(ctx, db, m, p); err != nil {
		return nil, fmt.Errorf("user %s: %w", p.Email, err)
	}
	subscriptions, err := seedCollections(ctx, db, m, p.ID, filepath.Join(fixtures, "subscriptions"))
	if err != nil {
		return nil, err
	}
	for name, id := range subscriptions {
		if _, err := m.Bestiary.Subscribe(ctx, u.ID, id); err != nil {
			return nil, fmt.Errorf("subscription to %s: %w", name, err)
		}
		collections[name] = id
	}

	return &showcaseOutput{RoomID: roomID, EmptyRoomID: emptyRoomID, Password: password, User: u, Sheets: sheets,
		EncounterID: encounter.ID, Collections: collections}, nil
}

// emptyRoom finds the user's room of that name, or makes it, and clears it.
func emptyRoom(ctx context.Context, db *pgxpool.Pool, m models.Models, userID int, name string) (int, error) {
	var id int
	err := db.QueryRow(ctx, `SELECT id FROM rooms WHERE owner_id = $1 AND name = $2 ORDER BY id LIMIT 1`,
		userID, name).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		id, err = m.Rooms.Create(ctx, userID, name)
	}
	if err != nil {
		return 0, fmt.Errorf("room %s: %w", name, err)
	}

	// Encounters take their NPCs, groups and places along; the party and its
	// groups belong to the room.
	for _, q := range []string{
		`DELETE FROM room_messages WHERE room_id = $1`,
		`DELETE FROM encounters WHERE room_id = $1`,
		`DELETE FROM encounter_participants WHERE room_id = $1`,
		`DELETE FROM initiative_groups WHERE room_id = $1`,
		`DELETE FROM character_sheets WHERE room_id = $1`,
		`DELETE FROM character_sheet_folders WHERE room_id = $1`,
	} {
		if _, err := db.Exec(ctx, q, id); err != nil {
			return 0, err
		}
	}
	return id, nil
}

// seedCollections replaces the user's collections, but the default one, with
// public ones from the collection files in dir.
func seedCollections(ctx context.Context, db *pgxpool.Pool, m models.Models, userID int, dir string) (map[string]int, error) {
	if _, err := db.Exec(ctx, `DELETE FROM bestiary_collections WHERE owner_id = $1 AND NOT is_default`, userID); err != nil {
		return nil, err
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	public := models.VisibilityPublic
	ids := map[string]int{}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		var f models.CollectionFile
		if err := json.Unmarshal(raw, &f); err != nil || f.Format != models.CollectionFileFormat {
			return nil, fmt.Errorf("%s is not a collection file", file)
		}
		c, err := m.Bestiary.CreateCollection(ctx, userID, f.Name)
		if err != nil {
			return nil, fmt.Errorf("collection %s: %w", f.Name, err)
		}
		edit := models.CollectionEdit{Description: &f.Description, Visibility: &public}
		if _, err := m.Bestiary.UpdateCollection(ctx, userID, c.ID, edit); err != nil {
			return nil, fmt.Errorf("collection %s: %w", f.Name, err)
		}
		if _, err := m.Bestiary.Upload(ctx, userID, c.ID, f.Creatures); err != nil {
			return nil, fmt.Errorf("creatures of %s: %w", file, err)
		}
		ids[f.Name] = c.ID
	}
	return ids, nil
}
