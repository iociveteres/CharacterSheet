package models

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

// Edit rights are checked on every write, against the access the sheet has
// at that moment: a player who still has the sheet open after the owner took
// the rights away is refused, and one given them is let in, with no reload.
func TestEditRightsFollowAccess(t *testing.T) {
	pool := newSheetHomesTestDB(t)
	ctx := context.Background()
	m := &CharacterSheetModel{DB: pool}
	ensurePath, err := os.ReadFile("../../migrations/000012_add_ensure_jsonb_path_function.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(ensurePath)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DROP FUNCTION IF EXISTS jsonb_ensure_path(jsonb, text[])`) })

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
	gm, owner, player := user("gm"), user("owner"), user("player")
	room := insert(`INSERT INTO rooms DEFAULT VALUES`)
	for u, role := range map[int]string{gm: "gamemaster", owner: "player", player: "player"} {
		if _, err := pool.Exec(ctx, `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)`, room, u, role); err != nil {
			t.Fatal(err)
		}
	}
	sheet := insert(`INSERT INTO character_sheets (owner_id, room_id, sheet_visibility, content) VALUES ($1, $2, 'everyone_can_edit', $3::jsonb)`,
		owner, room, `{"notes":{"items":{"n1":{"name":"a"},"n2":{"name":"b"}},"layouts":{"n1":{"colIndex":0,"rowIndex":0},"n2":{"colIndex":0,"rowIndex":1}}},
		  "talents":{"items":{},"layouts":{}}}`)

	name := []string{"characterInfo", "characterName"}
	notes := []string{"notes", "items"}
	pos := json.RawMessage(`{"colIndex":0,"rowIndex":0}`)
	// Every kind of write a sheet takes, each its own error.
	writes := map[string]func(userID int) error{
		"change": func(u int) error { _, err := m.ChangeField(ctx, u, sheet, name, []byte(`"x"`)); return err },
		"batch": func(u int) error {
			_, err := m.ApplyBatch(ctx, u, sheet, []string{"characterInfo"}, []byte(`{"race":"x"}`))
			return err
		},
		"create": func(u int) error { _, err := m.CreateItem(ctx, u, sheet, notes, "n9", pos, nil); return err },
		"positions": func(u int) error {
			_, err := m.ReplacePositions(ctx, u, sheet, notes, map[string]Position{"n1": {}})
			return err
		},
		"move": func(u int) error {
			_, _, err := m.MoveItemBetweenGrids(ctx, u, sheet, notes, []string{"talents", "items"}, "n2", pos)
			return err
		},
		"delete": func(u int) error { _, err := m.DeleteItem(ctx, u, sheet, []string{"notes", "items", "n1"}); return err },
	}
	// The writes that change nothing in the list come first, so each of them finds its item.
	order := []string{"change", "batch", "positions", "create", "move", "delete"}

	allDenied := func(t *testing.T, u int) {
		t.Helper()
		for _, w := range order {
			if err := writes[w](u); err != ErrPermissionDenied {
				t.Errorf("%s: got err %v, want ErrPermissionDenied", w, err)
			}
		}
	}
	allowed := func(t *testing.T, u int) {
		t.Helper()
		if err := writes["change"](u); err != nil {
			t.Errorf("change: %v", err)
		}
	}
	setVisibility := func(t *testing.T, v string) {
		t.Helper()
		if _, err := m.ChangeVisibility(ctx, owner, sheet, v); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("everyone_can_edit lets a member write", func(t *testing.T) {
		allowed(t, player)
	})

	t.Run("everyone_can_view refuses every write of a member, not of the owner or the gamemaster", func(t *testing.T) {
		setVisibility(t, "everyone_can_view")
		allDenied(t, player)
		allowed(t, owner)
		allowed(t, gm)
		if got := jsonAt(t, pool, sheet, "notes", "items", "n1"); got == "" {
			t.Error("a refused delete took the item")
		}
	})

	t.Run("everyone_can_edit again lets every write in", func(t *testing.T) {
		setVisibility(t, "everyone_can_edit")
		for _, w := range order {
			if err := writes[w](player); err != nil {
				t.Errorf("%s: %v", w, err)
			}
		}
	})

	t.Run("the folder's access wins over the sheet's", func(t *testing.T) {
		exec := func(sql string, args ...any) {
			t.Helper()
			if _, err := pool.Exec(ctx, sql, args...); err != nil {
				t.Fatal(err)
			}
		}
		// The schema of these tests has folders without names: the folder model does not fit it.
		folder := insert(`INSERT INTO character_sheet_folders (owner_id, room_id, folder_visibility) VALUES ($1, $2, 'everyone_can_view')`, owner, room)
		exec(`UPDATE character_sheets SET folder_id = $1 WHERE id = $2`, folder, sheet)
		if err := writes["change"](player); err != ErrPermissionDenied {
			t.Errorf("in a view-only folder: got err %v, want ErrPermissionDenied", err)
		}
		exec(`UPDATE character_sheet_folders SET folder_visibility = 'everyone_can_edit' WHERE id = $1`, folder)
		allowed(t, player)
		exec(`UPDATE character_sheets SET folder_id = NULL WHERE id = $1`, sheet)
		setVisibility(t, "everyone_can_view")
		if err := writes["change"](player); err != ErrPermissionDenied {
			t.Errorf("out of the folder again: got err %v, want ErrPermissionDenied", err)
		}
	})
}
