package models

import (
	"errors"
	"slices"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum"
)

func (d *wipeDB) exportState(user int) string {
	d.t.Helper()
	e, err := (&DataExportModel{DB: d.db}).Get(d.ctx, user)
	if errors.Is(err, ErrNoRecord) {
		return ""
	}
	if err != nil {
		d.t.Fatal(err)
	}
	return e.State
}

// The queue: in the order asked, one build per export, a limit of 30 minutes that a failed build
// does not count against, and an export gone while built.
func TestDataExportQueue(t *testing.T) {
	d := newWipeDB(t)
	m := &DataExportModel{DB: d.db}
	first, second := d.user("first"), d.user("second")

	for _, u := range []int{first, second, first} {
		if old, err := m.Request(d.ctx, u); err != nil || old != "" {
			t.Fatalf("request of %d: %q, %v", u, old, err)
		}
	}
	e, err := m.Get(d.ctx, second)
	if err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, e.State, ExportQueued)
	assert.Equal(t, e.Ahead, 1)
	if _, err := m.Get(d.ctx, d.user("none")); !errors.Is(err, ErrNoRecord) {
		t.Errorf("export of a user without one: %v", err)
	}

	claimed, err := m.Claim(d.ctx)
	if err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, claimed, first)
	assert.Equal(t, d.exportState(first), ExportBuilding)

	// A worker that holds the second's row: another skips it.
	tx, err := d.db.Begin(d.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(d.ctx, `SELECT 1 FROM data_exports WHERE user_id = $1 FOR UPDATE`, second); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Claim(d.ctx); !errors.Is(err, ErrNoRecord) {
		t.Errorf("claim past a locked row: %v", err)
	}
	tx.Rollback(d.ctx)

	if err := m.Finish(d.ctx, first, "a.zip", 10); err != nil {
		t.Fatal(err)
	}
	var tooSoon *ExportTooSoonError
	if _, err := m.Request(d.ctx, first); !errors.As(err, &tooSoon) {
		t.Fatalf("request within 30 minutes: %v", err)
	}
	assert.Equal(t, d.exportState(first), ExportReady)
	d.exec(`UPDATE data_exports SET requested_at = now() - interval '31 minutes' WHERE user_id = $1`, first)
	old, err := m.Request(d.ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, old, "a.zip")
	assert.Equal(t, d.exportState(first), ExportQueued)

	// The second, then the first again.
	assert.Equal(t, mustClaim(t, m, d), second)
	assert.Equal(t, mustClaim(t, m, d), first)
	if err := m.Fail(d.ctx, first); err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, d.exportState(first), ExportFailed)
	if _, err := m.Request(d.ctx, first); err != nil {
		t.Fatalf("request after a failed build: %v", err)
	}
	assert.Equal(t, d.exportState(first), ExportQueued)

	// The account wiped while its archive was built.
	assert.Equal(t, mustClaim(t, m, d), first)
	d.exec(`DELETE FROM data_exports WHERE user_id = $1`, first)
	if err := m.Finish(d.ctx, first, "b.zip", 10); !errors.Is(err, ErrNoRecord) {
		t.Errorf("finish of a deleted export: %v", err)
	}

	// The server stopped while the second's was built.
	n, err := m.RequeueBuilding(d.ctx)
	if err != nil || n != 1 {
		t.Fatalf("requeued %d, %v", n, err)
	}
	assert.Equal(t, d.exportState(second), ExportQueued)
	assert.Equal(t, mustClaim(t, m, d), second)
	if err := m.Requeue(d.ctx, second); err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, d.exportState(second), ExportQueued)
}

func mustClaim(t *testing.T, m *DataExportModel, d *wipeDB) int {
	t.Helper()
	u, err := m.Claim(d.ctx)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// Archives older than a day go, and so do forgotten ones.
func TestDataExportExpiry(t *testing.T) {
	d := newWipeDB(t)
	m := &DataExportModel{DB: d.db}
	old, fresh, failed, gone := d.user("old"), d.user("fresh"), d.user("failed"), d.user("gone")
	d.exec(`INSERT INTO data_exports (user_id, state, requested_at, ready_at, file_name, size) VALUES
($1, 'ready', now() - interval '26 hours', now() - interval '25 hours', 'old.zip', 1),
($2, 'ready', now() - interval '2 hours', now() - interval '1 hour', 'fresh.zip', 1),
($3, 'ready', now(), now(), 'gone.zip', 1)`, old, fresh, gone)
	d.exec(`INSERT INTO data_exports (user_id, state, requested_at) VALUES ($1, 'failed', now() - interval '25 hours')`, failed)

	files, err := m.DeleteExpired(d.ctx, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(files, []string{"old.zip"}) {
		t.Errorf("expired %v", files)
	}
	assert.Equal(t, d.exportState(old), "")
	assert.Equal(t, d.exportState(failed), "")
	assert.Equal(t, d.exportState(fresh), ExportReady)

	if err := m.Discard(d.ctx, gone, "other.zip"); err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, d.exportState(gone), ExportReady)
	if err := m.Discard(d.ctx, gone, "gone.zip"); err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, d.exportState(gone), "")
}

// The readers of the archive give the user's own data: their sheets and NPCs, not those of
// others nor their creatures (which go with the collections), their messages, posts and bans.
func TestExportContent(t *testing.T) {
	d := newWipeDB(t)
	m := &DataExportModel{DB: d.db}
	alice, bob := d.user("alice"), d.user("bob")
	room := d.room(alice, roomMember{alice, RoleGamemaster}, roomMember{bob, RolePlayer})
	d.room(bob, roomMember{bob, RoleGamemaster})
	d.exec(`INSERT INTO dice_presets (room_id, user_id, slot_number, dice_notation) VALUES ($1, $2, 1, '1d10'), ($1, $3, 1, '2d10')`, room, alice, bob)

	sheet := d.sheet(alice, room)
	bobSheet := d.sheet(bob, room)
	encounter := d.id(`INSERT INTO encounters (room_id, name) VALUES ($1, 'e')`, room)
	npc := d.id(`INSERT INTO character_sheets (owner_id, encounter_id, author_id) VALUES ($1, $2, $1)`, alice, encounter)
	d.id(`INSERT INTO character_sheets (owner_id, encounter_id) VALUES ($1, $2)`, bob, encounter)
	collection := d.int(`SELECT id FROM bestiary_collections WHERE owner_id = $1`, alice)
	creature := d.id(`INSERT INTO character_sheets (owner_id, collection_id) VALUES ($1, $2)`, alice, collection)
	d.exec(`INSERT INTO portrait_images (hash, mime, data) VALUES ('a', 'image/webp', 'x'), ('c', 'image/webp', 'x'), ('b', 'image/webp', 'x')`)
	d.exec(`INSERT INTO sheet_portraits (sheet_id, hash) VALUES ($1, 'a'), ($2, 'c'), ($3, 'b')`, sheet, creature, bobSheet)

	d.exec(`INSERT INTO room_messages (room_id, user_id, message_body) VALUES ($1, $2, 'mine'), ($1, $3, 'theirs')`, room, alice, bob)

	section := d.int(`SELECT min(id) FROM forum_sections`)
	topic := d.id(`INSERT INTO forum_topics (section_id, author_id, title) VALUES ($1, $2, 't')`, section, alice)
	d.id(`INSERT INTO forum_topics (section_id, author_id, title) VALUES ($1, $2, 'u')`, section, bob)
	d.id(`INSERT INTO forum_posts (topic_id, author_id, body) VALUES ($1, $2, 'mine')`, topic, alice)
	d.id(`INSERT INTO forum_posts (topic_id, author_id, body) VALUES ($1, $2, 'theirs')`, topic, bob)
	d.exec(`INSERT INTO forum_subscriptions (user_id, topic_id) VALUES ($1, $3), ($2, $3)`, alice, bob, topic)
	d.exec(`INSERT INTO forum_profiles (user_id, about) VALUES ($1, 'me')`, alice)
	d.exec(`INSERT INTO forum_bans (user_id, moderator_id, reason) VALUES ($1, $2, 'r')`, alice, bob)
	d.exec(`INSERT INTO user_avatar_locks (user_id, reason, moderator_id) VALUES ($1, 'r', $2)`, alice, bob)

	d.exec(`INSERT INTO user_name_history (user_id, name, changed_at) VALUES ($1, 'first', '2020-01-01'), ($1, 'second', '2021-01-01'), ($2, 'bob''s', '2022-01-01')`, alice, bob)
	d.exec(`INSERT INTO tokens (hash, user_id, expiry, scope, email) VALUES ('', $1, now() + interval '1 day', 'change_email_new', 'new@example.com')`, alice)

	account, err := m.Account(d.ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, account.Name, "alice")
	// The email being changed to stays out: it is a token, not the account's.
	assert.Equal(t, account.Email, "alice@example.com")
	if len(account.FormerNames) != 2 || account.FormerNames[0].Name != "second" || account.FormerNames[1].Name != "first" ||
		!account.FormerNames[1].ChangedAt.Equal(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("former names %+v, want all of alice's, newest first", account.FormerNames)
	}
	bobAccount, err := m.Account(d.ctx, bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(bobAccount.FormerNames) != 1 {
		t.Errorf("former names of bob %+v", bobAccount.FormerNames)
	}

	var sheets []ExportSheet
	if err := m.Sheets(d.ctx, alice, func(s ExportSheet) error { sheets = append(sheets, s); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(sheets) != 2 || sheets[0].ID != sheet || sheets[0].NPC || sheets[1].ID != npc || !sheets[1].NPC {
		t.Fatalf("sheets %+v, want the sheet %d and the NPC %d", sheets, sheet, npc)
	}
	if sheets[0].Author == nil || *sheets[0].Author != "alice" {
		t.Errorf("author of the sheet %v", sheets[0].Author)
	}

	rooms, err := m.Rooms(d.ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(rooms) != 1 || !rooms[0].Owner || rooms[0].Role == nil || *rooms[0].Role != RoleGamemaster ||
		len(rooms[0].DicePresets) != 1 || rooms[0].DicePresets[0].Notation != "1d10" {
		t.Errorf("rooms %+v", rooms)
	}

	collections, err := m.Collections(d.ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(collections) != 1 || collections[0].ID != collection {
		t.Errorf("collections %+v", collections)
	}
	hashes, err := m.PortraitHashes(d.ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(hashes, []string{"a", "c"}) {
		t.Errorf("portraits %v", hashes)
	}

	var texts []string
	if err := m.ChatMessages(d.ctx, alice, func(msg ExportMessage) error { texts = append(texts, msg.Text); return nil }); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(texts, []string{"mine"}) {
		t.Errorf("chat %v", texts)
	}

	var topics []int
	if err := m.ForumTopics(d.ctx, alice, func(tp forum.ExportTopic) error { topics = append(topics, tp.ID); return nil }); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(topics, []int{topic}) {
		t.Errorf("topics %v", topics)
	}
	var posts []string
	if err := m.ForumPosts(d.ctx, alice, func(p forum.ExportPost) error { posts = append(posts, p.Body); return nil }); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(posts, []string{"mine"}) {
		t.Errorf("posts %v", posts)
	}
	profile, err := m.ForumProfile(d.ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	if profile.About != "me" || len(profile.Subscriptions) != 1 {
		t.Errorf("profile %+v", profile)
	}
	moderation, err := m.Moderation(d.ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(moderation.ForumBans) != 1 || moderation.AvatarLock == nil {
		t.Errorf("moderation %+v", moderation)
	}
	moderation, err = m.Moderation(d.ctx, bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(moderation.ForumBans) != 0 || moderation.AvatarLock != nil {
		t.Errorf("bob's moderation %+v", moderation)
	}
}
