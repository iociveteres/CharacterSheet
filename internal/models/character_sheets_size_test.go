package models

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

// Over the 524288 bytes the content_size check allows.
var oversized = strings.Repeat("x", 600*1024)

func TestSheetContentSize(t *testing.T) {
	pool := newSheetHomesTestDB(t)
	ctx := context.Background()
	m := &CharacterSheetModel{DB: pool}
	// The edits need jsonb_ensure_path, which the sheet homes schema has none of.
	ensurePath, err := os.ReadFile("../../migrations/000012_add_ensure_jsonb_path_function.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(ensurePath)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DROP FUNCTION IF EXISTS jsonb_ensure_path(jsonb, text[])`) })

	var owner, room int
	if err := pool.QueryRow(ctx, `INSERT INTO users (name, email, hashed_password, created) VALUES ('owner', 'owner@example.com', '', now()) RETURNING id`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO rooms DEFAULT VALUES RETURNING id`).Scan(&room); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'player')`, room, owner); err != nil {
		t.Fatal(err)
	}
	sheet, err := m.Insert(ctx, owner, room, DefaultSheetKind)
	if err != nil {
		t.Fatal(err)
	}
	stored := func() (content string, version int) {
		t.Helper()
		if err := pool.QueryRow(ctx, `SELECT content::text, version FROM character_sheets WHERE id = $1`, sheet).Scan(&content, &version); err != nil {
			t.Fatal(err)
		}
		return content, version
	}
	before, beforeVersion := stored()
	value, _ := json.Marshal(oversized)

	t.Run("an edit that outgrows the limit changes nothing", func(t *testing.T) {
		_, err := m.ChangeField(ctx, owner, sheet, []string{"notes", "text"}, value)
		if !errors.Is(err, ErrSheetTooLarge) {
			t.Fatalf("ChangeField: %v, want ErrSheetTooLarge", err)
		}
		_, err = m.ApplyBatch(ctx, owner, sheet, []string{"notes"}, []byte(`{"text":`+string(value)+`}`))
		if !errors.Is(err, ErrSheetTooLarge) {
			t.Fatalf("ApplyBatch: %v, want ErrSheetTooLarge", err)
		}
		if after, version := stored(); after != before || version != beforeVersion {
			t.Errorf("the sheet changed: version %d, was %d", version, beforeVersion)
		}
	})

	t.Run("an edit under the limit is written", func(t *testing.T) {
		if _, err := m.ChangeField(ctx, owner, sheet, []string{"notes", "text"}, []byte(`"short"`)); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("an import over the limit is refused", func(t *testing.T) {
		_, err := m.InsertWithContent(ctx, owner, room, DefaultSheetKind, json.RawMessage(`{"notes":{"text":`+string(value)+`}}`))
		if !errors.Is(err, ErrSheetTooLarge) {
			t.Fatalf("InsertWithContent: %v, want ErrSheetTooLarge", err)
		}
	})

	// NOT VALID leaves a sheet stored before the check as it is; its copy is new.
	t.Run("a copy of a sheet stored before the limit is refused", func(t *testing.T) {
		var old int
		if _, err := pool.Exec(ctx, `ALTER TABLE character_sheets DROP CONSTRAINT content_size`); err != nil {
			t.Fatal(err)
		}
		err := pool.QueryRow(ctx, `
            INSERT INTO character_sheets (owner_id, room_id, sheet_kind, content, created_at, updated_at)
            VALUES ($1, $2, $3, jsonb_build_object('notes', jsonb_build_object('text', $4::text)), now(), now())
            RETURNING id`, owner, room, DefaultSheetKind, oversized).Scan(&old)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `ALTER TABLE character_sheets ADD CONSTRAINT content_size CHECK (octet_length(content::text) <= 524288) NOT VALID`); err != nil {
			t.Fatal(err)
		}

		_, err = copySheet(ctx, pool, owner, old, SheetHome{RoomID: &room}, "Copy")
		if !errors.Is(err, ErrSheetTooLarge) {
			t.Fatalf("copySheet: %v, want ErrSheetTooLarge", err)
		}
	})
}
