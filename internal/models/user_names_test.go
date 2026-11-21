package models

import (
	"errors"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestInsertTakenNameOrEmail(t *testing.T) {
	d := newWipeDB(t)
	m := UserModel{DB: d.db}

	_, err := m.Insert(d.ctx, "Иван", "ivan@example.com", "pa$$word", "")
	assert.NilError(t, err)
	// Names compare regardless of case, Cyrillic too.
	for _, name := range []string{"Иван", "иван", "ИВАН"} {
		if _, err := m.Insert(d.ctx, name, name+"@example.com", "pa$$word", ""); !errors.Is(err, ErrDuplicateName) {
			t.Errorf("%s: got %v, want ErrDuplicateName", name, err)
		}
	}
	if _, err := m.Insert(d.ctx, "Пётр", "ivan@example.com", "pa$$word", ""); !errors.Is(err, ErrDuplicateEmail) {
		t.Errorf("got %v, want ErrDuplicateEmail", err)
	}
	assert.Equal(t, d.int(`SELECT count(*) FROM users`), 1)
}

func TestRename(t *testing.T) {
	d := newWipeDB(t)
	ivan, bob := d.user("ivan"), d.user("bob")
	m := UserModel{DB: d.db}
	history := func(want ...string) {
		t.Helper()
		got, err := m.NameHistory(d.ctx, ivan, 0)
		assert.NilError(t, err)
		names := make([]string, len(got))
		for i, c := range got {
			names[i] = c.Name
			if time.Since(c.ChangedAt) > time.Minute {
				t.Errorf("%s changed at %v", c.Name, c.ChangedAt)
			}
		}
		if len(names) != len(want) {
			t.Fatalf("history %q, want %q", names, want)
		}
		for i := range want {
			if names[i] != want[i] {
				t.Fatalf("history %q, want %q", names, want)
			}
		}
	}
	name := func() string { return d.text(`SELECT name FROM users WHERE id = $1`, ivan) }

	// The same name in another case is the same name: no history.
	assert.NilError(t, m.Rename(d.ctx, ivan, "Ivan"))
	assert.Equal(t, name(), "Ivan")
	history()
	assert.NilError(t, m.Rename(d.ctx, ivan, "Ivan"))
	history()

	assert.NilError(t, m.Rename(d.ctx, ivan, "Иван"))
	assert.NilError(t, m.Rename(d.ctx, ivan, "ИВАН"))
	assert.Equal(t, name(), "ИВАН")
	history("Ivan")

	if err := m.Rename(d.ctx, ivan, "BOB"); !errors.Is(err, ErrDuplicateName) {
		t.Errorf("got %v, want ErrDuplicateName", err)
	}
	assert.Equal(t, name(), "ИВАН")
	history("Ivan")

	assert.NilError(t, m.Rename(d.ctx, ivan, "Pyotr"))
	assert.NilError(t, m.Rename(d.ctx, ivan, "Pavel"))
	history("Pyotr", "ИВАН", "Ivan")
	last, err := m.NameHistory(d.ctx, ivan, 2)
	assert.NilError(t, err)
	if len(last) != 2 || last[0].Name != "Pyotr" || last[1].Name != "ИВАН" {
		t.Errorf("last two %+v", last)
	}
	// A former name is free at once.
	assert.NilError(t, m.Rename(d.ctx, bob, "ivan"))
	none, err := m.NameHistory(d.ctx, 0, 10)
	assert.NilError(t, err)
	assert.Equal(t, len(none), 0)

	d.exec(`UPDATE users SET status = 'deleting' WHERE id = $1`, ivan)
	if err := m.Rename(d.ctx, ivan, "Someone"); !errors.Is(err, ErrNoRecord) {
		t.Errorf("an account in its grace period: got %v, want ErrNoRecord", err)
	}
}
