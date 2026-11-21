package forumtest

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"github.com/jackc/pgx/v5/pgxpool"
)

func forumTables(t *testing.T, db *pgxpool.Pool) int {
	t.Helper()
	var n int
	err := db.QueryRow(context.Background(), `
		SELECT count(*) FROM information_schema.tables
		WHERE table_schema = current_schema() AND table_name LIKE 'forum\_%'`).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestMigrationsRollBackAndApplyAgain(t *testing.T) {
	db := NewDB(t)
	run := func(direction string) {
		t.Helper()
		for _, file := range migrations(t, direction) {
			b, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(context.Background(), string(b)); err != nil {
				t.Fatalf("%s: %v", filepath.Base(file), err)
			}
		}
	}
	tables := forumTables(t, db)
	if tables == 0 {
		t.Fatal("no forum tables after the migrations")
	}

	run("down")
	assert.Equal(t, forumTables(t, db), 0)

	run("up")
	assert.Equal(t, forumTables(t, db), tables)
}

func TestSchemasDoNotMeet(t *testing.T) {
	a := NewDB(t)
	t.Run("inner", func(t *testing.T) {
		b := NewDB(t)
		User(t, b, "only in b", time.Now())
		var n int
		if err := a.QueryRow(context.Background(), `SELECT count(*) FROM users`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		assert.Equal(t, n, 0)
	})
}
