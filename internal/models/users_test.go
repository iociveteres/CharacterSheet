package models

import (
	"context"
	"errors"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestUserModelExists(t *testing.T) {
	// Skip the test if the "-short" flag is provided when running the test.
	if testing.Short() {
		t.Skip("models: skipping integration test")
	}
	// Set up a suite of table-driven tests and expected results.
	tests := []struct {
		name   string
		userID int
		want   bool
	}{
		{
			name:   "Valid ID",
			userID: 1,
			want:   true,
		},
		{
			name:   "Zero ID",
			userID: 0,
			want:   false,
		},
		{
			name:   "Non-existent ID",
			userID: 2,
			want:   false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Call the newTestDB() helper function to get a connection pool to
			// our test database. Calling this here -- inside t.Run() -- means
			// that fresh database tables and data will be set up and torn down
			// for each sub-test.
			db := newTestDB(t)
			// Create a new instance of the UserModel.
			m := UserModel{db}
			// Call the UserModel.Exists() method and check that the return
			// value and error match the expected values for the sub-test.
			exists, err := m.Exists(context.Background(), tt.userID)
			assert.Equal(t, exists, tt.want)
			assert.NilError(t, err)
		})
	}
}

func TestUserModelInsertMakesDefaultCollection(t *testing.T) {
	if testing.Short() {
		t.Skip("models: skipping integration test")
	}
	db := newSheetHomesTestDB(t)
	ctx := context.Background()
	m := UserModel{db}

	id, err := m.Insert(ctx, "Bob", "bob@example.com", "pa$$word")
	if err != nil {
		t.Fatal(err)
	}
	var name string
	var visibility CollectionVisibility
	err = db.QueryRow(ctx, `SELECT name, visibility FROM bestiary_collections WHERE owner_id = $1 AND is_default`, id).Scan(&name, &visibility)
	if err != nil || name != "My creatures" || visibility != VisibilityPrivate {
		t.Errorf("default collection %q %q, %v", name, visibility, err)
	}

	// A taken email leaves neither a user nor a collection.
	if _, err := m.Insert(ctx, "Bob", "bob@example.com", "pa$$word"); !errors.Is(err, ErrDuplicateEmail) {
		t.Errorf("got %v, want ErrDuplicateEmail", err)
	}
	var n int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM bestiary_collections WHERE name = 'My creatures'`).Scan(&n); err != nil || n != 2 {
		t.Errorf("%d default collections, want Alice's of the migration and Bob's", n)
	}
}
