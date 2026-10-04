package models

import (
	"encoding/base64"
	"errors"
	"math/rand/v2"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// incompressible is n characters that Postgres stores as they are: a filler
// that takes as much of the quota as its length.
func incompressible(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(rand.Uint32())
	}
	return base64.StdEncoding.EncodeToString(b)[:n]
}

// into is a copy's target: the user's collection id.
func into(collectionID int) CollectionTarget {
	return CollectionTarget{CollectionID: collectionID}
}

func (r *encounterRoom) collection(owner int, name string) int {
	r.t.Helper()
	return r.insert(`INSERT INTO bestiary_collections (owner_id, name) VALUES ($1, $2)`, owner, name)
}

func (r *encounterRoom) creature(owner, collection int, name string) int {
	r.t.Helper()
	return r.insert(`INSERT INTO character_sheets (owner_id, author_id, collection_id, content) VALUES ($1, $1, $2, jsonb_build_object('characterInfo', jsonb_build_object('characterName', $3::text)))`,
		owner, collection, name)
}

func TestCreatureIsItsCollectionOwners(t *testing.T) {
	r := newEncounterRoom(t)
	creature := r.creature(r.gm, r.collection(r.gm, "Orks"), "Ork Boy")

	for u, want := range map[int]bool{r.gm: true, r.moderator: false, r.player: false, r.outsider: false} {
		var view, edit bool
		err := r.pool.QueryRow(r.ctx, `SELECT can_view_character_sheet($1, $2), can_edit_character_sheet($1, $2)`, u, creature).Scan(&view, &edit)
		if err != nil {
			t.Fatal(err)
		}
		if view != want || edit != want {
			t.Errorf("user %d: view %v edit %v, want %v", u, view, edit, want)
		}
	}

	// The gamemaster of the room does not see another user's creature.
	other := r.creature(r.player, r.collection(r.player, "Mine"), "Grot")
	if _, err := r.sheets.GetWithPermission(r.ctx, r.gm, other); !errors.Is(err, ErrPermissionDenied) {
		t.Errorf("the gamemaster opened a player's creature: %v", err)
	}

	view, err := r.sheets.GetWithPermission(r.ctx, r.gm, creature)
	if err != nil {
		t.Fatal(err)
	}
	if !view.CanEdit || view.HomeRoomID != 0 || view.CharacterSheet.CollectionID == nil {
		t.Errorf("view %+v, home room %d", view.CharacterSheet, view.HomeRoomID)
	}
}

func TestCreatureIsInNoRoom(t *testing.T) {
	r := newEncounterRoom(t)
	creature := r.creature(r.gm, r.collection(r.gm, "Orks"), "Ork Boy")
	a, err := r.sheets.Audience(r.ctx, creature)
	if err != nil {
		t.Fatal(err)
	}
	if a.RoomID == r.room || a.RoomID == r.other || len(a.Viewers) != 0 || len(a.Named) != 0 {
		t.Errorf("audience %+v", a)
	}
	// Its edits go through the bestiary socket of its collection's owner.
	if a.CollectionOwnerID != r.gm {
		t.Errorf("collection owner %d, want %d", a.CollectionOwnerID, r.gm)
	}
}

func TestCreatureHasOneHome(t *testing.T) {
	r := newEncounterRoom(t)
	s := r.create("Ambush")
	c := r.collection(r.gm, "Orks")
	for name, home := range map[string][3]*int{
		"room and collection":      {&r.room, nil, &c},
		"encounter and collection": {nil, &s.ID, &c},
	} {
		_, err := r.pool.Exec(r.ctx, `INSERT INTO character_sheets (owner_id, room_id, encounter_id, collection_id) VALUES ($1, $2, $3, $4)`,
			r.gm, home[0], home[1], home[2])
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.ConstraintName != "one_home" {
			t.Errorf("%s: %v, want the one_home check to fail", name, err)
		}
	}
}

func TestDeletingCollectionTakesItsCreatures(t *testing.T) {
	r := newEncounterRoom(t)
	c := r.collection(r.gm, "Orks")
	creature := r.creature(r.gm, c, "Ork Boy")
	s := r.create("Ambush")
	npc, err := copySheet(r.ctx, r.pool, r.gm, creature, SheetHome{EncounterID: &s.ID}, "Ork Boy 1")
	if err != nil {
		t.Fatal(err)
	}

	r.exec(`DELETE FROM bestiary_collections WHERE id = $1`, c)
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE id = $1`, creature); n != 0 {
		t.Error("the creature outlived its collection")
	}
	if n := r.count(`SELECT count(*) FROM character_sheets WHERE id = $1 AND source_sheet_id IS NULL`, npc); n != 1 {
		t.Error("the NPC copy still points at the creature")
	}
}

func TestQuotaCountsCreatures(t *testing.T) {
	r := newEncounterRoom(t)
	c := r.collection(r.gm, "Orks")
	big := r.insert(`INSERT INTO character_sheets (owner_id, collection_id, content)
        VALUES ($1, $2, jsonb_build_object('characterInfo', jsonb_build_object('characterName', $3::text)))`,
		r.gm, c, incompressible(QuotaBytes-100))

	used, err := r.sheets.QuotaUsed(r.ctx, r.gm)
	if err != nil || used < QuotaBytes-100 {
		t.Errorf("used %d, %v", used, err)
	}
	var quota *QuotaError
	if _, err := r.encounters.AddCreature(r.ctx, r.ref(r.create("Ambush")), big, 1); !errors.As(err, &quota) {
		t.Errorf("got %v, want a QuotaError", err)
	}
}

func TestSharedCreatureRights(t *testing.T) {
	r := newEncounterRoom(t)
	c := r.collection(r.player, "Orks")
	creature := r.creature(r.player, c, "Ork Boy")
	// Subscribed while it was public: a subscription gives no access.
	r.exec(`INSERT INTO bestiary_subscriptions (user_id, collection_id) VALUES ($1, $2)`, r.gm, c)
	stranger := r.insert(`INSERT INTO users (name, email, hashed_password, created) VALUES ('stranger', 'stranger@example.com', '', now())`)

	tests := []struct {
		visibility string
		views      map[int]bool
	}{
		{"private", map[int]bool{r.player: true, r.gm: false, r.moderator: false, r.outsider: false, stranger: false}},
		// Anyone signed in, a member of no room too.
		{"public", map[int]bool{r.player: true, r.gm: true, r.moderator: true, r.outsider: true, stranger: true}},
	}
	for _, tt := range tests {
		r.exec(`UPDATE bestiary_collections SET visibility = $2 WHERE id = $1`, c, tt.visibility)
		for u, want := range tt.views {
			var view, edit bool
			err := r.pool.QueryRow(r.ctx, `SELECT can_view_character_sheet($1, $2), can_edit_character_sheet($1, $2)`, u, creature).Scan(&view, &edit)
			if err != nil {
				t.Fatal(err)
			}
			if view != want || edit != (u == r.player) {
				t.Errorf("%s, user %d: view %v edit %v, want view %v", tt.visibility, u, view, edit, want)
			}
		}
	}

	// A public creature of another user opens read-only and in no room: the
	// hub rejects its edits, the room page redirects.
	r.exec(`UPDATE bestiary_collections SET visibility = 'public' WHERE id = $1`, c)
	view, err := r.sheets.GetWithPermission(r.ctx, stranger, creature)
	if err != nil {
		t.Fatal(err)
	}
	if view.CanEdit || view.HomeRoomID != 0 {
		t.Errorf("can edit %v, home room %d", view.CanEdit, view.HomeRoomID)
	}
}
