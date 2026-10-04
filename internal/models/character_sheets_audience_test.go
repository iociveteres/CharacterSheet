package models

import (
	"context"
	"errors"
	"os"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// newSheetHomesTestDB adds the rooms, sheets, encounters and collections on top
// of the base test database: the tables as they were before migration 000032,
// then the migrations themselves, so the tests run their tables and permission
// functions.
func newSheetHomesTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := newTestDB(t)
	ctx := context.Background()

	exec := func(file string) {
		t.Helper()
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(b)); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
	}

	// Clean up leftovers of an interrupted run before creating the schema.
	exec("./testdata/sheet_homes_teardown.sql")
	exec("./testdata/sheet_homes_setup.sql")
	exec("../../migrations/000032_add_encounters.up.sql")
	exec("../../migrations/000033_add_bestiary.up.sql")
	exec("../../migrations/000034_share_bestiary.up.sql")
	exec("../../migrations/000035_add_can_view_collection.up.sql")
	exec("../../migrations/000036_add_character_name.up.sql")
	exec("../../migrations/000037_add_default_collection.up.sql")
	exec("../../migrations/000038_add_party.up.sql")
	exec("../../migrations/000039_add_creature_author.up.sql")
	t.Cleanup(func() { exec("./testdata/sheet_homes_teardown.sql") })

	return pool
}

func TestAudience(t *testing.T) {
	pool := newSheetHomesTestDB(t)
	ctx := context.Background()
	m := &CharacterSheetModel{DB: pool}

	insert := func(sql string, args ...any) int {
		t.Helper()
		var id int
		if err := pool.QueryRow(ctx, sql+" RETURNING id", args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	user := func(name string) int {
		return insert(`INSERT INTO users (name, email, hashed_password, created) VALUES ($1, $2, '', now())`, name, name+"@example.com")
	}
	gm, moderator, owner, player, outsider := user("gm"), user("moderator"), user("owner"), user("player"), user("outsider")

	room := insert(`INSERT INTO rooms DEFAULT VALUES`)
	other := insert(`INSERT INTO rooms DEFAULT VALUES`)
	for u, role := range map[int]string{gm: "gamemaster", moderator: "moderator", owner: "player", player: "player"} {
		if _, err := pool.Exec(ctx, `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)`, room, u, role); err != nil {
			t.Fatal(err)
		}
	}
	// A member of another room sees nothing of this one, whatever the visibility.
	if _, err := pool.Exec(ctx, `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'gamemaster')`, other, outsider); err != nil {
		t.Fatal(err)
	}

	sheet := func(visibility string, folder *int) int {
		return insert(`INSERT INTO character_sheets (owner_id, room_id, sheet_visibility, folder_id) VALUES ($1, $2, $3, $4)`, owner, room, visibility, folder)
	}
	hiddenFolder := insert(`INSERT INTO character_sheet_folders (owner_id, room_id, folder_visibility) VALUES ($1, $2, 'hide_from_players')`, owner, room)

	listedFolder := insert(`INSERT INTO character_sheet_folders (owner_id, room_id, folder_visibility) VALUES ($1, $2, 'everyone_can_see')`, owner, room)

	all, elevated := []int{gm, moderator, owner, player}, []int{gm, moderator, owner}
	tests := []struct {
		name  string
		sheet int
		want  []int
		named []int
	}{
		{"visible", sheet("everyone_can_view", nil), all, all},
		{"editable", sheet("everyone_can_edit", nil), all, all},
		// Players see such a sheet in the list, but cannot open it.
		{"listed only", sheet("everyone_can_see", nil), elevated, all},
		{"hidden", sheet("hide_from_players", nil), elevated, elevated},
		{"visible in a hidden folder", sheet("everyone_can_view", &hiddenFolder), elevated, elevated},
		{"hidden in a listed folder", sheet("hide_from_players", &listedFolder), elevated, all},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a, err := m.Audience(ctx, tt.sheet)
			if err != nil {
				t.Fatal(err)
			}
			if a.RoomID != room || a.CollectionOwnerID != 0 {
				t.Errorf("room %d, collection owner %d, want room %d", a.RoomID, a.CollectionOwnerID, room)
			}
			got := slices.Sorted(slices.Values(a.Viewers))
			want := slices.Sorted(slices.Values(tt.want))
			if !slices.Equal(got, want) {
				t.Errorf("viewers %v, want %v", got, want)
			}
			got = slices.Sorted(slices.Values(a.Named))
			want = slices.Sorted(slices.Values(tt.named))
			if !slices.Equal(got, want) {
				t.Errorf("named %v, want %v", got, want)
			}
		})
	}

	t.Run("missing sheet", func(t *testing.T) {
		if _, err := m.Audience(ctx, 1_000_000); !errors.Is(err, ErrNoRecord) {
			t.Errorf("got %v, want ErrNoRecord", err)
		}
	})
}
