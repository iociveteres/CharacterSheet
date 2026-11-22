package models

import (
	"context"
	"errors"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"golang.org/x/crypto/bcrypt"
)

func TestDeletionSummary(t *testing.T) {
	d := newWipeDB(t)
	leaver, bob, carol, gm, former := d.user("leaver"), d.user("bob"), d.user("carol"), d.user("gm"), d.user("former")

	// Alone in a room, with the sheet of a member who left it; a room the leaver made and left
	// with nobody in it; both go.
	lone := d.room(leaver, roomMember{leaver, RoleGamemaster})
	d.sheet(former, lone)
	d.sheet(leaver, lone)
	empty := d.room(leaver)
	// The leaver's room with others: bob joined first, carol is the gamemaster.
	owned := d.room(leaver, roomMember{leaver, RoleGamemaster}, roomMember{bob, RolePlayer}, roomMember{carol, RoleGamemaster})
	d.sheet(leaver, owned)
	// A room of another with two of the leaver's sheets, one an NPC of an encounter.
	theirs := d.room(gm, roomMember{gm, RoleGamemaster}, roomMember{leaver, RolePlayer})
	d.sheet(leaver, theirs)
	encounter := d.id(`INSERT INTO encounters (room_id, name) VALUES ($1, 'fight')`, theirs)
	d.exec(`INSERT INTO character_sheets (owner_id, encounter_id) VALUES ($1, $2)`, leaver, encounter)

	d.exec(`INSERT INTO bestiary_collections (owner_id, name, visibility, published_at) VALUES ($1, 'quiet', 'public', now())`, leaver)
	shared := d.id(`INSERT INTO bestiary_collections (owner_id, name, visibility, published_at) VALUES ($1, 'shared', 'public', now())`, leaver)
	d.exec(`INSERT INTO bestiary_subscriptions (user_id, collection_id) VALUES ($1, $2), ($3, $2)`, bob, shared, carol)

	d.exec(`INSERT INTO room_messages (room_id, user_id, message_body) VALUES ($1, $2, 'a'), ($1, $2, 'b')`, theirs, leaver)
	section := d.int(`SELECT min(id) FROM forum_sections`)
	topic := d.id(`INSERT INTO forum_topics (section_id, author_id, title) VALUES ($1, $2, 't')`, section, leaver)
	d.exec(`INSERT INTO forum_posts (topic_id, author_id, body) VALUES ($1, $2, 'x')`, topic, leaver)
	d.exec(`INSERT INTO forum_posts (topic_id, author_id, body, deleted_at) VALUES ($1, $2, 'y', now())`, topic, leaver)
	d.exec(`INSERT INTO forum_moderators (user_id) VALUES ($1)`, leaver)

	m := UserModel{DB: d.db}
	s, err := m.DeletionSummary(d.ctx, leaver)
	assert.NilError(t, err)
	assert.Equal(t, s.Name, "leaver")
	if len(s.LoneRooms) != 2 || s.LoneRooms[0].ID != lone || s.LoneRooms[1].ID != empty {
		t.Errorf("lone rooms %+v, want %d and %d", s.LoneRooms, lone, empty)
	}
	assert.Equal(t, s.FormerMembersSheets, 1)
	if len(s.OwnedRooms) != 1 || s.OwnedRooms[0].ID != owned {
		t.Fatalf("owned rooms %+v, want %d", s.OwnedRooms, owned)
	}
	r := s.OwnedRooms[0]
	if len(r.Members) != 2 || r.Members[0].ID != bob || r.Members[1].ID != carol {
		t.Errorf("members %+v, want bob then carol", r.Members)
	}
	assert.Equal(t, r.DefaultHeir, carol)
	// The sheet in the owned room and the two in the room of another.
	assert.Equal(t, s.HandedSheets, 3)
	assert.Equal(t, len(s.DeletedCollections), 2)
	if len(s.KeptCollections) != 1 || s.KeptCollections[0].Name != "shared" || s.KeptCollections[0].Subscribers != 2 {
		t.Errorf("kept collections %+v", s.KeptCollections)
	}
	assert.Equal(t, s.ChatMessages, 2)
	assert.Equal(t, s.ForumPosts, 1)
	assert.Equal(t, s.Moderator, true)

	// Without gamemasters among the others the earliest member is the default.
	d.exec(`UPDATE room_members SET role = 'player' WHERE room_id = $1 AND user_id = $2`, owned, carol)
	s, err = m.DeletionSummary(d.ctx, leaver)
	assert.NilError(t, err)
	assert.Equal(t, s.OwnedRooms[0].DefaultHeir, bob)
}

func TestScheduleAndCancelDeletion(t *testing.T) {
	d := newWipeDB(t)
	leaver, bob, outsider := d.user("leaver"), d.user("bob"), d.user("outsider")
	owned := d.room(leaver, roomMember{leaver, RoleGamemaster}, roomMember{bob, RolePlayer})
	other := d.room(bob, roomMember{bob, RoleGamemaster}, roomMember{leaver, RolePlayer})
	users, tokens := UserModel{DB: d.db}, TokenModel{DB: d.db}

	link, err := tokens.New(d.ctx, leaver, time.Hour, ScopeDeleteAccount)
	assert.NilError(t, err)
	othersLink, err := tokens.New(d.ctx, outsider, time.Hour, ScopeDeleteAccount)
	assert.NilError(t, err)
	expired, err := tokens.New(d.ctx, leaver, -time.Minute, ScopeDeleteAccount)
	assert.NilError(t, err)
	choices := DeletionChoices{ChatMessages: true, PublicCollections: true,
		// Only the first is a room of the leaver with the heir in it.
		Heirs: map[int]int{owned: bob, other: leaver}}
	for name, token := range map[string]string{"another's": othersLink.Plaintext, "expired": expired.Plaintext} {
		if _, err := users.ScheduleDeletion(d.ctx, leaver, token, choices); !errors.Is(err, ErrNoRecord) {
			t.Errorf("%s token: %v", name, err)
		}
	}
	assert.Equal(t, d.text(`SELECT status::text FROM users WHERE id = $1`, leaver), string(statusEmailVerified))

	scheduled, err := users.ScheduleDeletion(d.ctx, leaver, link.Plaintext, choices)
	assert.NilError(t, err)
	if time.Until(scheduled.DeleteAt) < DeletionGrace-time.Minute || time.Until(scheduled.DeleteAt) > DeletionGrace+time.Minute {
		t.Errorf("delete_at %v, want in %v", scheduled.DeleteAt, DeletionGrace)
	}
	assert.Equal(t, d.text(`SELECT status::text FROM users WHERE id = $1`, leaver), string(statusDeleting))
	if !d.exists(`SELECT 1 FROM account_deletions WHERE user_id = $1 AND delete_chat_messages AND NOT wipe_forum_posts
	AND delete_public_collections AND heirs = jsonb_build_object($2::int::text, $3::int)`, leaver, owned, bob) {
		t.Error("the row does not keep the choices, or keeps an heir of a room not the leaver's")
	}
	pending, err := users.PendingDeletion(d.ctx, leaver)
	assert.NilError(t, err)
	if !pending.Equal(scheduled.DeleteAt) {
		t.Errorf("pending deletion at %v, want %v", pending, scheduled.DeleteAt)
	}
	// The link is used up; the cancel link holds until the wipe stops waiting for the reminder.
	if _, err := users.ScheduleDeletion(d.ctx, leaver, link.Plaintext, choices); !errors.Is(err, ErrNoRecord) {
		t.Errorf("the link works twice: %v", err)
	}
	owner, err := tokens.UserID(d.ctx, ScopeCancelDeletion, scheduled.CancelToken)
	assert.NilError(t, err)
	assert.Equal(t, owner, leaver)
	if !d.exists(`SELECT 1 FROM tokens t JOIN account_deletions a ON a.user_id = t.user_id
	WHERE t.user_id = $1 AND t.scope = 'cancel_deletion' AND abs(extract(epoch FROM t.expiry - a.delete_at) - $2) < 60`,
		leaver, ReminderWait.Seconds()) {
		t.Error("the cancel token does not expire 7 days after delete_at")
	}

	assert.NilError(t, users.CancelDeletion(d.ctx, leaver))
	assert.Equal(t, d.text(`SELECT status::text FROM users WHERE id = $1`, leaver), string(statusEmailVerified))
	if d.exists(`SELECT 1 FROM account_deletions WHERE user_id = $1`, leaver) ||
		d.exists(`SELECT 1 FROM tokens WHERE user_id = $1 AND scope = 'cancel_deletion'`, leaver) {
		t.Error("the row or a cancel token stays after the cancellation")
	}
	if _, err := users.PendingDeletion(d.ctx, leaver); !errors.Is(err, ErrNoRecord) {
		t.Errorf("pending deletion after the cancellation: %v", err)
	}
	if err := users.CancelDeletion(d.ctx, leaver); !errors.Is(err, ErrNoRecord) {
		t.Errorf("second cancellation: %v", err)
	}
	if _, err := users.Wipe(d.ctx, leaver); !errors.Is(err, ErrNoRecord) {
		t.Errorf("wipe after the cancellation: %v", err)
	}
	assert.Equal(t, d.text(`SELECT name FROM users WHERE id = $1`, leaver), "leaver")
}

// A cancellation after the wipe deletes nothing and changes nothing.
func TestCancelAfterWipe(t *testing.T) {
	d := newWipeDB(t)
	leaver := d.user("leaver")
	d.schedule(leaver, false, false, false, nil)
	d.wipe(leaver)
	m := UserModel{DB: d.db}
	if err := m.CancelDeletion(d.ctx, leaver); !errors.Is(err, ErrNoRecord) {
		t.Errorf("cancellation after the wipe: %v", err)
	}
	assert.Equal(t, d.text(`SELECT status::text FROM users WHERE id = $1`, leaver), string(statusDeleted))
	if !d.exists(`SELECT 1 FROM account_deletions WHERE user_id = $1 AND wiped_at IS NOT NULL`, leaver) {
		t.Error("the row of the wipe is gone")
	}
}

// A cancellation that comes while a wipe holds the deletion row waits for its commit and finds
// the row wiped. The transaction below takes the locks Wipe takes, in its order.
func TestCancelDuringWipe(t *testing.T) {
	d := newWipeDB(t)
	leaver := d.user("leaver")
	d.schedule(leaver, false, false, false, nil)

	wipe, err := d.db.Begin(d.ctx)
	assert.NilError(t, err)
	defer wipe.Rollback(d.ctx)
	_, err = wipe.Exec(d.ctx, `SELECT 1 FROM account_deletions WHERE user_id = $1 AND wiped_at IS NULL FOR UPDATE`, leaver)
	assert.NilError(t, err)
	_, err = wipe.Exec(d.ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, leaver)
	assert.NilError(t, err)
	_, err = wipe.Exec(d.ctx, `UPDATE users SET status = 'deleted', name = '' WHERE id = $1`, leaver)
	assert.NilError(t, err)
	_, err = wipe.Exec(d.ctx, `UPDATE account_deletions SET wiped_at = now() WHERE user_id = $1`, leaver)
	assert.NilError(t, err)

	m := UserModel{DB: d.db}
	done := make(chan error, 1)
	go func() { done <- m.CancelDeletion(context.Background(), leaver) }()
	select {
	case err := <-done:
		t.Fatalf("the cancellation did not wait for the wipe: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	assert.NilError(t, wipe.Commit(d.ctx))
	select {
	case err := <-done:
		if !errors.Is(err, ErrNoRecord) {
			t.Errorf("cancellation during the wipe: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the cancellation still waits")
	}
	assert.Equal(t, d.text(`SELECT status::text FROM users WHERE id = $1`, leaver), string(statusDeleted))
}

// A password reset changes the password whatever the status, and tells an account that may not
// sign in as Authenticate does.
func TestPasswordResetStatuses(t *testing.T) {
	d := newWipeDB(t)
	users, tokens := UserModel{DB: d.db}, TokenModel{DB: d.db}
	tests := []struct {
		status userStatus
		want   error
	}{
		{statusEmailVerified, nil},
		{statusPending, ErrUserNotActivated},
		{statusDeleting, ErrDeletionScheduled},
	}
	for _, tt := range tests {
		t.Run(string(tt.status), func(t *testing.T) {
			id := d.user(string(tt.status))
			d.exec(`UPDATE users SET status = $2 WHERE id = $1`, id, tt.status)
			token, err := tokens.New(d.ctx, id, time.Hour, ScopeChangePassword)
			assert.NilError(t, err)
			got, err := users.PasswordReset(d.ctx, token.Plaintext, "new password")
			if !errors.Is(err, tt.want) || (tt.want == nil && err != nil) {
				t.Errorf("PasswordReset: %v, want %v", err, tt.want)
			}
			assert.Equal(t, got, id)
			hash := d.text(`SELECT hashed_password FROM users WHERE id = $1`, id)
			assert.NilError(t, bcrypt.CompareHashAndPassword([]byte(hash), []byte("new password")))
		})
	}
}
