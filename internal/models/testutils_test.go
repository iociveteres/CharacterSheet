package models

import (
	"context"
	"os"
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
