// Package forumtest gives tests of the forum and of the app a forum database of their own: a
// Postgres schema with a minimal users table and every forum migration. go test runs packages at
// once and the tests of internal/models create and drop users in the public schema of the same
// database, so the forum never shares tables with them.
package forumtest

import (
	"context"
	_ "embed"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed forum_setup.sql
var setupSQL string

//go:embed forum_teardown.sql
var teardownSQL string

// NewDB returns a pool whose search_path is a fresh schema with users and the tables of
// migrations/*_forum_*.up.sql, dropped when the test ends. Needs Postgres on localhost:5432
// (test_web / pass, database test_charactersheet), as the tests of internal/models.
func NewDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, caller, _, _ := runtime.Caller(1)
	dsn := "postgres://test_web:pass@localhost:5432/test_charactersheet?sslmode=disable&timezone=UTC" +
		"&search_path=" + schemaName(filepath.Dir(caller), t.Name())
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	exec := func(ctx context.Context, name, sql string) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}

	// The name is the same on every run, so this also drops the leftovers of an interrupted one.
	exec(ctx, "forum_teardown.sql", teardownSQL)
	t.Cleanup(func() {
		exec(context.Background(), "forum_teardown.sql", teardownSQL)
		pool.Close()
	})
	exec(ctx, "forum_setup.sql", setupSQL)
	for _, file := range migrations(t, "up") {
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		exec(ctx, filepath.Base(file), string(b))
	}
	return pool
}

// schemaName is one per test of a package: packages and parallel tests never share a schema.
func schemaName(dir, test string) string {
	h := fnv.New64a()
	h.Write([]byte(dir + "\x00" + test))
	return fmt.Sprintf("forum_test_%016x", h.Sum64())
}

// migrations lists the forum migrations of one direction in the order migrate applies them.
func migrations(t *testing.T, direction string) []string {
	t.Helper()
	_, self, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(self), "..", "..", "..")
	files, err := filepath.Glob(filepath.Join(root, "migrations", "*_forum_*."+direction+".sql"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no forum migrations in " + filepath.Join(root, "migrations"))
	}
	sort.Strings(files)
	if direction == "down" {
		sort.Sort(sort.Reverse(sort.StringSlice(files)))
	}
	return files
}

// User adds a user to the test users table and returns its id.
func User(t *testing.T, db *pgxpool.Pool, name string, createdAt time.Time) int {
	t.Helper()
	var id int
	err := db.QueryRow(context.Background(),
		`INSERT INTO users (name, created_at) VALUES ($1, $2) RETURNING id`, name, createdAt).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
