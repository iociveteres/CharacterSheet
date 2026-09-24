package models

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// newSheetItemsTestDB adds the character_sheets table and the JSONB helpers
// on top of the base test database. jsonb_ensure_path comes straight from its
// migration, so the tests run against the real function.
func newSheetItemsTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := newTestDB(t)
	ctx := context.Background()

	exec := func(file string) {
		t.Helper()
		script, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(script)); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
	}

	// Clean up leftovers of an interrupted run before creating the schema.
	exec("./testdata/sheet_items_teardown.sql")
	exec("./testdata/sheet_items_setup.sql")
	exec("../../migrations/000012_add_ensure_jsonb_path_function.up.sql")
	t.Cleanup(func() { exec("./testdata/sheet_items_teardown.sql") })

	return pool
}

func insertSheet(t *testing.T, pool *pgxpool.Pool, content string) int {
	t.Helper()
	var id int
	err := pool.QueryRow(context.Background(),
		`INSERT INTO character_sheets (content) VALUES ($1::jsonb) RETURNING id`, content).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// jsonAt returns the JSON at path in the sheet content, or "" if it is absent.
func jsonAt(t *testing.T, pool *pgxpool.Pool, sheetID int, path ...string) string {
	t.Helper()
	var raw []byte
	err := pool.QueryRow(context.Background(),
		`SELECT content #> $1::text[] FROM character_sheets WHERE id = $2`, path, sheetID).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	if raw == nil {
		return ""
	}
	return string(raw)
}

func assertPosition(t *testing.T, got string, want Position) {
	t.Helper()
	if got == "" {
		t.Fatalf("position not stored, want %+v", want)
	}
	var pos Position
	if err := json.Unmarshal([]byte(got), &pos); err != nil {
		t.Fatalf("decode position %q: %v", got, err)
	}
	if pos != want {
		t.Fatalf("got position %+v, want %+v", pos, want)
	}
}

func TestCreateItemStoresPosition(t *testing.T) {
	pool := newSheetItemsTestDB(t)
	m := &CharacterSheetModel{DB: pool}
	ctx := context.Background()
	gridPath := []string{"conditions", "list", "items"}
	pos := json.RawMessage(`{"colIndex":1,"rowIndex":0}`)
	init := json.RawMessage(`{"name":"Stunned","enabled":true}`)

	tests := []struct {
		name    string
		content string
	}{
		{"grid missing", `{}`},
		{"layouts null", `{"conditions":{"list":{"items":{},"layouts":null}}}`},
		{"layouts empty", `{"conditions":{"list":{"items":{},"layouts":{}}}}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id := insertSheet(t, pool, tt.content)

			if _, err := m.CreateItem(ctx, 1, id, gridPath, "cond-1", pos, init); err != nil {
				t.Fatal(err)
			}

			if got := jsonAt(t, pool, id, "conditions", "list", "items", "cond-1", "name"); got != `"Stunned"` {
				t.Errorf("item name = %s, want \"Stunned\"", got)
			}
			assertPosition(t, jsonAt(t, pool, id, "conditions", "list", "layouts", "cond-1"), Position{ColIndex: 1})
		})
	}

	t.Run("keeps existing positions", func(t *testing.T) {
		id := insertSheet(t, pool, `{"conditions":{"list":{
			"items":{"cond-0":{"name":"Old"}},
			"layouts":{"cond-0":{"colIndex":0,"rowIndex":0}}}}}`)

		if _, err := m.CreateItem(ctx, 1, id, gridPath, "cond-1", pos, init); err != nil {
			t.Fatal(err)
		}

		assertPosition(t, jsonAt(t, pool, id, "conditions", "list", "layouts", "cond-0"), Position{})
		assertPosition(t, jsonAt(t, pool, id, "conditions", "list", "layouts", "cond-1"), Position{ColIndex: 1})
	})

	t.Run("nested grid of a new item", func(t *testing.T) {
		id := insertSheet(t, pool, `{"conditions":{"list":{"items":{"cond-0":{"name":"Old"}}}}}`)
		entriesPath := []string{"conditions", "list", "items", "cond-0", "entries", "items"}

		if _, err := m.CreateItem(ctx, 1, id, entriesPath, "entry-1", json.RawMessage(`{"colIndex":0,"rowIndex":2}`), json.RawMessage(`{"type":"char_bonus"}`)); err != nil {
			t.Fatal(err)
		}

		assertPosition(t, jsonAt(t, pool, id, "conditions", "list", "items", "cond-0", "entries", "layouts", "entry-1"), Position{RowIndex: 2})
	})

	t.Run("denied", func(t *testing.T) {
		id := insertSheet(t, pool, `{}`)

		if _, err := m.CreateItem(ctx, 2, id, gridPath, "cond-1", pos, init); err != ErrPermissionDenied {
			t.Fatalf("got err %v, want ErrPermissionDenied", err)
		}
		if got := jsonAt(t, pool, id, "conditions"); got != "" {
			t.Errorf("content changed: conditions = %s", got)
		}
	})
}

func TestMoveItemBetweenGridsStoresPosition(t *testing.T) {
	pool := newSheetItemsTestDB(t)
	m := &CharacterSheetModel{DB: pool}
	ctx := context.Background()

	id := insertSheet(t, pool, `{"gear":{"list":{
		"items":{"g-1":{"name":"Rope","entries":{"items":{"e-1":{"type":"char_bonus","name":"S"}},"layouts":{"e-1":{"colIndex":0,"rowIndex":0}}}},
		         "g-2":{"name":"Hook"}},
		"layouts":{"g-1":{"colIndex":0,"rowIndex":0},"g-2":{"colIndex":0,"rowIndex":1}}}}}`)

	from := []string{"gear", "list", "items", "g-1", "entries", "items"}
	to := []string{"gear", "list", "items", "g-2", "entries", "items"}
	if _, err := m.MoveItemBetweenGrids(ctx, 1, id, from, to, "e-1", json.RawMessage(`{"colIndex":0,"rowIndex":0}`)); err != nil {
		t.Fatal(err)
	}

	if got := jsonAt(t, pool, id, "gear", "list", "items", "g-2", "entries", "items", "e-1", "name"); got != `"S"` {
		t.Errorf("moved item name = %s, want \"S\"", got)
	}
	assertPosition(t, jsonAt(t, pool, id, "gear", "list", "items", "g-2", "entries", "layouts", "e-1"), Position{})
	if got := jsonAt(t, pool, id, "gear", "list", "items", "g-1", "entries", "layouts", "e-1"); got != "" {
		t.Errorf("source position left behind: %s", got)
	}
}
