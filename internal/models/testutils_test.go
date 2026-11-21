package models

import (
	"context"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestDB sets up a PostgreSQL test database via pgxpool.
// It reads ./testdata/setup.sql, executes it, and registers a cleanup
// to run ./testdata/teardown.sql and close the pool.
func newTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()

	// Construct your DSN for the test database:
	dsn := "postgres://test_web:pass@localhost:5432/test_charactersheet?sslmode=disable&timezone=UTC"

	// 1) Open the pgxpool
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	// Ensure the pool is actually working
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatal(err)
	}

	// 2) Run setup script
	script, err := os.ReadFile("./testdata/setup.sql")
	if err != nil {
		pool.Close()
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(script)); err != nil {
		pool.Close()
		t.Fatal(err)
	}

	// 3) Register teardown
	t.Cleanup(func() {
		// Read teardown
		script, err := os.ReadFile("./testdata/teardown.sql")
		if err != nil {
			t.Fatal(err)
		}
		// Execute teardown
		if _, err := pool.Exec(context.Background(), string(script)); err != nil {
			t.Fatal(err)
		}
		// Close pool
		pool.Close()
	})

	return pool
}

// newMigratedTestDB returns a pool whose search_path is a fresh schema with every migration of
// migrations/ applied in order: the schema of production, for tests that touch most of it, like the
// wipe of an account. The schema is one per test and dropped when it ends, so it shares nothing
// with the public schema of newTestDB or with the forum's (forumtest).
func newMigratedTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	h := fnv.New64a()
	h.Write([]byte(t.Name()))
	schema := fmt.Sprintf("models_test_%016x", h.Sum64())
	dsn := "postgres://test_web:pass@localhost:5432/test_charactersheet?sslmode=disable&timezone=UTC&search_path=" + schema
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
	drop := `DROP SCHEMA IF EXISTS ` + schema + ` CASCADE`
	// The name is the same on every run, so this also drops the leftovers of an interrupted one.
	exec(ctx, "drop schema", drop)
	t.Cleanup(func() {
		exec(context.Background(), "drop schema", drop)
		pool.Close()
	})
	exec(ctx, "create schema", `CREATE SCHEMA `+schema)

	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil || len(files) == 0 {
		t.Fatalf("no migrations: %v", err)
	}
	sort.Strings(files)
	for _, file := range files {
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		exec(ctx, filepath.Base(file), string(b))
	}
	return pool
}
