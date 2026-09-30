package models

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// functionFromMigration cuts the CREATE statement of a SQL function out of a
// migration, so the test runs the function the database has, not a copy.
func functionFromMigration(t *testing.T, file, name string) string {
	t.Helper()
	b, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	start := strings.Index(s, "CREATE OR REPLACE FUNCTION "+name)
	if start < 0 {
		t.Fatalf("%s: no function %s", file, name)
	}
	const end = "$$ LANGUAGE sql STABLE;"
	n := strings.Index(s[start:], end)
	if n < 0 {
		t.Fatalf("%s: function %s has no end", file, name)
	}
	return s[start : start+n+len(end)]
}

func newSheetAudienceTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := newTestDB(t)
	ctx := context.Background()

	exec := func(sql string) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	file := func(name string) string {
		t.Helper()
		b, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}

	// Clean up leftovers of an interrupted run before creating the schema.
	exec(file("./testdata/sheet_audience_teardown.sql"))
	exec(file("./testdata/sheet_audience_setup.sql"))
	exec(functionFromMigration(t, "../../migrations/000019_add_sheet_folders.up.sql", "can_view_character_sheet"))
	t.Cleanup(func() { exec(file("./testdata/sheet_audience_teardown.sql")) })

	return pool
}

func TestAudience(t *testing.T) {
	pool := newSheetAudienceTestDB(t)
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
			if a.RoomID != room {
				t.Errorf("room %d, want %d", a.RoomID, room)
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
