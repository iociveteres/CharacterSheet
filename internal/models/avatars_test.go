package models

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type avatarTest struct {
	t    *testing.T
	ctx  context.Context
	pool *pgxpool.Pool
	m    *AvatarModel
}

func newAvatarTest(t *testing.T) *avatarTest {
	pool := newSheetHomesTestDB(t)
	return &avatarTest{t: t, ctx: context.Background(), pool: pool, m: &AvatarModel{DB: pool}}
}

func (a *avatarTest) user(name string) int {
	a.t.Helper()
	var id int
	if err := a.pool.QueryRow(a.ctx, `INSERT INTO users (name, email, hashed_password, created) VALUES ($1, $2, '', now()) RETURNING id`,
		name, name+"@example.com").Scan(&id); err != nil {
		a.t.Fatal(err)
	}
	return id
}

func (a *avatarTest) put(userID int, data string) string {
	a.t.Helper()
	hash, err := a.m.Put(a.ctx, userID, "image/webp", []byte(data))
	if err != nil {
		a.t.Fatal(err)
	}
	return hash
}

func (a *avatarTest) hashes(userIDs ...int) map[int]string {
	a.t.Helper()
	hashes, err := a.m.Hashes(a.ctx, userIDs)
	if err != nil {
		a.t.Fatal(err)
	}
	return hashes
}

func (a *avatarTest) remove(userID int, lock *AvatarLock) {
	a.t.Helper()
	if err := a.m.Remove(a.ctx, userID, lock); err != nil {
		a.t.Fatal(err)
	}
}

func (a *avatarTest) lockOf(userID int) *AvatarLock {
	a.t.Helper()
	lock, err := a.m.LockOf(a.ctx, userID)
	if err != nil {
		a.t.Fatal(err)
	}
	return lock
}

func TestAvatarPutGetDelete(t *testing.T) {
	a := newAvatarTest(t)
	mira, olaf, nobody := a.user("mira"), a.user("olaf"), a.user("nobody")

	first := a.put(mira, "first")
	if len(first) != 16 {
		t.Fatalf("hash %q, want 16 hex", first)
	}
	got, err := a.m.Get(a.ctx, first)
	if err != nil || got.Mime != "image/webp" || string(got.Data) != "first" {
		t.Fatalf("Get = %+v, %v", got, err)
	}

	// A new image replaces the old one, which is not kept.
	second := a.put(mira, "second")
	if second == first {
		t.Fatal("a new image kept the old hash")
	}
	if _, err := a.m.Get(a.ctx, first); !errors.Is(err, ErrNoRecord) {
		t.Errorf("the replaced image: %v, want ErrNoRecord", err)
	}
	a.put(olaf, "olaf")

	hashes := a.hashes(mira, olaf, nobody)
	if len(hashes) != 2 || hashes[mira] != second || hashes[olaf] == "" {
		t.Errorf("Hashes = %v", hashes)
	}
	if len(a.hashes()) != 0 {
		t.Error("Hashes of no users is not empty")
	}

	if err := a.m.Delete(a.ctx, mira); err != nil {
		t.Fatal(err)
	}
	if _, err := a.m.Get(a.ctx, second); !errors.Is(err, ErrNoRecord) {
		t.Errorf("the deleted image: %v, want ErrNoRecord", err)
	}
	if _, ok := a.hashes(mira)[mira]; ok {
		t.Error("the deleted avatar is still in Hashes")
	}
	// Deleting nothing is no error.
	if err := a.m.Delete(a.ctx, mira); err != nil {
		t.Error(err)
	}
	if _, ok := a.hashes(olaf)[olaf]; !ok {
		t.Error("deleting one user's avatar took another's")
	}
}

func TestAvatarPutChecksImage(t *testing.T) {
	a := newAvatarTest(t)
	mira := a.user("mira")
	for name, tt := range map[string]struct {
		mime string
		data []byte
	}{
		"png":       {"image/png", []byte("x")},
		"empty":     {"image/webp", nil},
		"too large": {"image/jpeg", make([]byte, AvatarMaxBytes+1)},
	} {
		if _, err := a.m.Put(a.ctx, mira, tt.mime, tt.data); !errors.Is(err, ErrInvalidAvatar) {
			t.Errorf("%s: %v, want ErrInvalidAvatar", name, err)
		}
	}
	if _, err := a.m.Put(a.ctx, mira, "image/jpeg", make([]byte, AvatarMaxBytes)); err != nil {
		t.Errorf("the largest image: %v", err)
	}
	if _, err := a.m.Put(a.ctx, 999999, "image/webp", []byte("x")); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a missing user: %v, want ErrNoRecord", err)
	}
}

func TestAvatarLock(t *testing.T) {
	a := newAvatarTest(t)
	mira, olaf, moderator := a.user("mira"), a.user("olaf"), a.user("moderator")
	hash := a.put(mira, "mira")

	until := time.Now().Add(7 * 24 * time.Hour).Truncate(time.Second)
	a.remove(mira, &AvatarLock{Until: &until, Reason: "rule 3", ModeratorID: moderator})
	if _, err := a.m.Get(a.ctx, hash); !errors.Is(err, ErrNoRecord) {
		t.Errorf("the removed image: %v, want ErrNoRecord", err)
	}
	lock := a.lockOf(mira)
	if lock == nil || lock.UserID != mira || lock.Until == nil || !lock.Until.Equal(until) ||
		lock.Reason != "rule 3" || lock.ModeratorID != moderator || lock.CreatedAt.IsZero() {
		t.Fatalf("LockOf = %+v", lock)
	}
	if _, err := a.m.Put(a.ctx, mira, "image/webp", []byte("again")); !errors.Is(err, ErrAvatarLocked) {
		t.Errorf("an upload under a lock: %v, want ErrAvatarLocked", err)
	}
	if a.lockOf(olaf) != nil {
		t.Error("a lock reached another user")
	}
	a.put(olaf, "olaf")

	// Removing again replaces the lock: for good now.
	a.remove(mira, &AvatarLock{Reason: "again", ModeratorID: moderator})
	if lock := a.lockOf(mira); lock == nil || lock.Until != nil || lock.Reason != "again" {
		t.Errorf("the lock for good: %+v", lock)
	}

	if err := a.m.Unlock(a.ctx, mira); err != nil {
		t.Fatal(err)
	}
	if a.lockOf(mira) != nil {
		t.Error("the lock outlived Unlock")
	}
	a.put(mira, "after the lock")

	// Without a lock Remove only deletes.
	a.remove(olaf, nil)
	if len(a.hashes(olaf)) != 0 || a.lockOf(olaf) != nil {
		t.Error("Remove without a lock")
	}
	a.put(olaf, "olaf again")
}

// A lock whose time is up stops by itself: no job deletes it.
func TestAvatarLockExpires(t *testing.T) {
	a := newAvatarTest(t)
	mira, olaf, moderator := a.user("mira"), a.user("olaf"), a.user("moderator")
	a.remove(mira, &AvatarLock{Reason: "for good", ModeratorID: moderator})
	soon := time.Now().Add(time.Hour)
	a.remove(olaf, &AvatarLock{Until: &soon, Reason: "an hour", ModeratorID: moderator})

	locks, err := a.m.Locks(a.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(locks) != 2 || locks[0].UserID != olaf || locks[1].UserID != mira {
		t.Fatalf("Locks = %+v, want olaf's then mira's", locks)
	}

	if _, err := a.pool.Exec(a.ctx, `UPDATE user_avatar_locks SET until = now() - interval '1 second' WHERE user_id = $1`, olaf); err != nil {
		t.Fatal(err)
	}
	if a.lockOf(olaf) != nil {
		t.Error("an expired lock holds")
	}
	a.put(olaf, "olaf")
	locks, err = a.m.Locks(a.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(locks) != 1 || locks[0].UserID != mira {
		t.Errorf("Locks after one expired = %+v", locks)
	}
}
