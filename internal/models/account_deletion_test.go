package models

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// wipeDB is a database of production's schema (newMigratedTestDB) with helpers to fill it.
type wipeDB struct {
	t   *testing.T
	db  *pgxpool.Pool
	ctx context.Context
	// joined counts the members added, so that each joins later than the one before.
	joined int
}

func newWipeDB(t *testing.T) *wipeDB {
	if testing.Short() {
		t.Skip("models: skipping integration test")
	}
	return &wipeDB{t: t, db: newMigratedTestDB(t), ctx: context.Background()}
}

func (d *wipeDB) exec(sql string, args ...any) {
	d.t.Helper()
	if _, err := d.db.Exec(d.ctx, sql, args...); err != nil {
		d.t.Fatalf("%s: %v", sql, err)
	}
}

// id runs an INSERT and returns the id of its row.
func (d *wipeDB) id(sql string, args ...any) int {
	d.t.Helper()
	var id int
	if err := d.db.QueryRow(d.ctx, sql+" RETURNING id", args...).Scan(&id); err != nil {
		d.t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (d *wipeDB) int(sql string, args ...any) int {
	d.t.Helper()
	var n int
	if err := d.db.QueryRow(d.ctx, sql, args...).Scan(&n); err != nil {
		d.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (d *wipeDB) text(sql string, args ...any) string {
	d.t.Helper()
	var s string
	if err := d.db.QueryRow(d.ctx, sql, args...).Scan(&s); err != nil {
		d.t.Fatalf("%s: %v", sql, err)
	}
	return s
}

// user is a confirmed account with its default collection, as UserModel.Insert makes it.
func (d *wipeDB) user(name string) int {
	d.t.Helper()
	id := d.id(`INSERT INTO users (name, email, hashed_password, status) VALUES ($1, $2, repeat('x', 60), 'email_verified')`, name, name+"@example.com")
	d.exec(`INSERT INTO bestiary_collections (owner_id, name, is_default) VALUES ($1, 'My creatures', true)`, id)
	return id
}

type roomMember struct {
	id   int
	role RoomRole
}

// room is a room of owner with the members, who join in the order given.
func (d *wipeDB) room(owner int, members ...roomMember) int {
	d.t.Helper()
	id := d.id(`INSERT INTO rooms (owner_id, name) VALUES ($1, 'room')`, owner)
	for _, m := range members {
		d.joined++
		d.exec(`INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES ($1, $2, $3, now() - make_interval(days => 100 - $4))`,
			id, m.id, m.role, d.joined)
	}
	return id
}

// sheet is a character of the room, last changed long ago.
func (d *wipeDB) sheet(owner, room int) int {
	d.t.Helper()
	return d.id(`INSERT INTO character_sheets (owner_id, room_id, updated_at) VALUES ($1, $2, '2020-01-01')`, owner, room)
}

func (d *wipeDB) owner(sheet int) int {
	d.t.Helper()
	return d.int(`SELECT owner_id FROM character_sheets WHERE id = $1`, sheet)
}

func (d *wipeDB) exists(sql string, args ...any) bool {
	d.t.Helper()
	var b bool
	if err := d.db.QueryRow(d.ctx, `SELECT EXISTS (`+sql+`)`, args...).Scan(&b); err != nil {
		d.t.Fatalf("%s: %v", sql, err)
	}
	return b
}

func (d *wipeDB) schedule(user int, chat, posts, publicCollections bool, heirs map[int]int) {
	d.t.Helper()
	b, err := json.Marshal(heirs)
	if err != nil {
		d.t.Fatal(err)
	}
	d.exec(`INSERT INTO account_deletions (user_id, delete_at, delete_chat_messages, wipe_forum_posts, delete_public_collections, heirs)
VALUES ($1, now(), $2, $3, $4, $5)`, user, chat, posts, publicCollections, b)
	d.exec(`UPDATE users SET status = 'deleting' WHERE id = $1`, user)
}

func (d *wipeDB) wipe(user int) *WipedAccount {
	d.t.Helper()
	m := UserModel{DB: d.db}
	w, err := m.Wipe(d.ctx, user)
	if err != nil {
		d.t.Fatal(err)
	}
	return w
}

func TestWipeRooms(t *testing.T) {
	d := newWipeDB(t)
	leaver, gm, player, other, owner, early := d.user("leaver"), d.user("gm"), d.user("player"), d.user("other"), d.user("owner"), d.user("early")

	// The leaver is alone: the room goes with the sheet of a former member.
	alone := d.room(leaver, roomMember{leaver, RoleGamemaster})
	formerSheet := d.sheet(player, alone)
	d.sheet(leaver, alone)
	// Alone in a room another made and left: it goes all the same.
	aloneOfAnother := d.room(owner, roomMember{leaver, RolePlayer})

	// The leaver's room, handed to the heir chosen: a player, who becomes a gamemaster and gets
	// the leaver's sheet, its hidden folder and an NPC.
	chosen := d.room(leaver, roomMember{leaver, RoleGamemaster}, roomMember{player, RolePlayer}, roomMember{gm, RoleGamemaster})
	folder := d.id(`INSERT INTO character_sheet_folders (owner_id, room_id, name, folder_visibility) VALUES ($1, $2, 'f', 'hide_from_players')`, leaver, chosen)
	chosenSheet := d.sheet(leaver, chosen)
	d.exec(`UPDATE character_sheets SET folder_id = $1 WHERE id = $2`, folder, chosenSheet)
	encounter := d.id(`INSERT INTO encounters (room_id, name) VALUES ($1, 'e')`, chosen)
	npc := d.id(`INSERT INTO character_sheets (owner_id, encounter_id, author_id) VALUES ($1, $2, $1)`, leaver, encounter)

	// The heir chosen has left the room: the earliest other gamemaster gets it.
	heirLeft := d.room(leaver, roomMember{leaver, RoleGamemaster}, roomMember{player, RolePlayer}, roomMember{gm, RoleGamemaster}, roomMember{other, RoleGamemaster})
	heirLeftSheet := d.sheet(leaver, heirLeft)

	// Made by the leaver, who left it: the earliest member gets it and becomes a gamemaster.
	left := d.room(leaver, roomMember{early, RolePlayer}, roomMember{player, RolePlayer})
	leftSheet := d.sheet(leaver, left)
	// Made and left, nobody in it: it goes.
	empty := d.room(leaver)

	// A room of another with its owner as the gamemaster: the sheet and the folder go to the owner.
	ofOwner := d.room(owner, roomMember{owner, RoleGamemaster}, roomMember{leaver, RolePlayer})
	ownerFolder := d.id(`INSERT INTO character_sheet_folders (owner_id, room_id, name) VALUES ($1, $2, 'f')`, leaver, ofOwner)
	ofOwnerSheet := d.sheet(leaver, ofOwner)

	// The leaver was its only gamemaster: the owner becomes one, though another joined earlier.
	onlyGM := d.room(owner, roomMember{early, RolePlayer}, roomMember{owner, RolePlayer}, roomMember{leaver, RoleGamemaster})
	onlyGMSheet := d.sheet(leaver, onlyGM)

	// Removed from a room, the leaver's sheet stayed: the gamemaster gets it.
	removed := d.room(owner, roomMember{owner, RoleGamemaster})
	removedSheet := d.sheet(leaver, removed)
	// Removed from a room nobody is in any more: the sheet goes, the room stays.
	removedEmpty := d.room(owner)
	removedEmptySheet := d.sheet(leaver, removedEmpty)

	// The heir's NPCs and creatures are over the quota already: those of the leaver still go to them.
	d.exec(`INSERT INTO portrait_images (hash, mime, data)
SELECT 'p' || g, 'image/webp', convert_to(repeat('x', 131072), 'UTF8') FROM generate_series(1, 81) g`)
	collection := d.int(`SELECT id FROM bestiary_collections WHERE owner_id = $1`, player)
	d.exec(`WITH s AS (
    INSERT INTO character_sheets (owner_id, collection_id) SELECT $1, $2 FROM generate_series(1, 81) RETURNING id
)
INSERT INTO sheet_portraits (sheet_id, hash) SELECT id, 'p' || row_number() OVER (ORDER BY id) FROM s`, player, collection)

	d.schedule(leaver, false, false, false, map[int]int{chosen: player, heirLeft: early})
	handed := []int{chosenSheet, npc, heirLeftSheet, leftSheet, ofOwnerSheet, onlyGMSheet, removedSheet}
	versions := d.int(`SELECT sum(version) FROM character_sheets WHERE id = ANY($1)`, handed)
	w := d.wipe(leaver)

	want := []WipedRoom{
		{RoomID: chosen, HeirID: player, PromotedID: player},
		{RoomID: heirLeft, HeirID: gm},
		{RoomID: left, HeirID: early, PromotedID: early},
		{RoomID: ofOwner, HeirID: owner},
		{RoomID: onlyGM, HeirID: owner, PromotedID: owner},
		{RoomID: removed, HeirID: owner},
	}
	if !slices.Equal(w.Rooms, want) {
		t.Errorf("rooms\n got %+v\nwant %+v", w.Rooms, want)
	}

	for _, id := range []int{alone, aloneOfAnother, empty} {
		if d.exists(`SELECT 1 FROM rooms WHERE id = $1`, id) {
			t.Errorf("room %d stays", id)
		}
	}
	if d.exists(`SELECT 1 FROM character_sheets WHERE id = $1`, formerSheet) {
		t.Error("the sheet of a former member stays in the room deleted")
	}
	if !d.exists(`SELECT 1 FROM rooms WHERE id = $1`, removedEmpty) || d.exists(`SELECT 1 FROM character_sheets WHERE id = $1`, removedEmptySheet) {
		t.Error("a room nobody is in lost itself or kept the leaver's sheet")
	}

	owners := map[int]int{chosen: player, heirLeft: gm, left: early}
	for room, want := range owners {
		assert.Equal(t, d.int(`SELECT owner_id FROM rooms WHERE id = $1`, room), want)
		assert.Equal(t, d.text(`SELECT role::text FROM room_members WHERE room_id = $1 AND user_id = $2`, room, want), string(RoleGamemaster))
	}
	assert.Equal(t, d.text(`SELECT role::text FROM room_members WHERE room_id = $1 AND user_id = $2`, onlyGM, owner), string(RoleGamemaster))
	assert.Equal(t, d.text(`SELECT role::text FROM room_members WHERE room_id = $1 AND user_id = $2`, onlyGM, early), string(RolePlayer))

	sheets := map[int]int{chosenSheet: player, npc: player, heirLeftSheet: gm, leftSheet: early, ofOwnerSheet: owner, onlyGMSheet: owner, removedSheet: owner}
	for sheet, want := range sheets {
		assert.Equal(t, d.owner(sheet), want)
	}
	assert.Equal(t, d.int(`SELECT owner_id FROM character_sheet_folders WHERE id = $1`, folder), player)
	assert.Equal(t, d.int(`SELECT owner_id FROM character_sheet_folders WHERE id = $1`, ownerFolder), owner)
	assert.Equal(t, d.int(`SELECT folder_id FROM character_sheets WHERE id = $1`, chosenSheet), folder)
	if d.exists(`SELECT 1 FROM character_sheets WHERE id = ANY($1) AND id <> $2 AND updated_at <> '2020-01-01'`, handed, npc) {
		t.Error("a sheet handed on has a new updated_at")
	}
	assert.Equal(t, d.int(`SELECT sum(version) FROM character_sheets WHERE id = ANY($1)`, handed), versions)
	// The NPC forgets its author with the account.
	if d.exists(`SELECT 1 FROM character_sheets WHERE id = $1 AND author_id IS NOT NULL`, npc) {
		t.Error("the NPC keeps the leaver as its author")
	}
	used, err := quotaUsed(d.ctx, d.db, player)
	assert.NilError(t, err)
	if used <= QuotaBytes {
		t.Errorf("the heir uses %d bytes, the test wants them over the quota", used)
	}

	if d.exists(`SELECT 1 FROM character_sheets WHERE owner_id = $1`, leaver) ||
		d.exists(`SELECT 1 FROM character_sheet_folders WHERE owner_id = $1`, leaver) ||
		d.exists(`SELECT 1 FROM room_members WHERE user_id = $1`, leaver) ||
		d.exists(`SELECT 1 FROM rooms WHERE owner_id = $1`, leaver) {
		t.Error("the tombstone still has sheets, folders or rooms")
	}
}

func TestWipeChatMessages(t *testing.T) {
	d := newWipeDB(t)
	deleting, keeping, gm := d.user("deleting"), d.user("keeping"), d.user("gm")
	room := d.room(gm, roomMember{gm, RoleGamemaster}, roomMember{deleting, RolePlayer}, roomMember{keeping, RolePlayer})
	// A room the user has only messages in, removed from it long ago.
	past := d.room(gm, roomMember{gm, RoleGamemaster})
	say := func(room, user int) {
		d.exec(`INSERT INTO room_messages (room_id, user_id, message_body) VALUES ($1, $2, 'hi')`, room, user)
	}
	say(room, deleting)
	say(past, deleting)
	say(room, keeping)
	say(room, gm)

	d.schedule(deleting, true, false, false, nil)
	w := d.wipe(deleting)
	want := []WipedRoom{{RoomID: room, HeirID: gm, MessagesDeleted: true}, {RoomID: past, MessagesDeleted: true}}
	if !slices.Equal(w.Rooms, want) {
		t.Errorf("rooms\n got %+v\nwant %+v", w.Rooms, want)
	}
	assert.Equal(t, d.int(`SELECT count(*) FROM room_messages WHERE user_id = $1`, deleting), 0)

	d.schedule(keeping, false, false, false, nil)
	w = d.wipe(keeping)
	if !slices.Equal(w.Rooms, []WipedRoom{{RoomID: room, HeirID: gm}}) {
		t.Errorf("rooms %+v", w.Rooms)
	}
	assert.Equal(t, d.int(`SELECT count(*) FROM room_messages WHERE user_id = $1`, keeping), 1)
	assert.Equal(t, d.int(`SELECT count(*) FROM room_messages WHERE user_id = $1`, gm), 1)
}

func TestWipeCollections(t *testing.T) {
	d := newWipeDB(t)
	leaver, all, subscriber := d.user("leaver"), d.user("all"), d.user("subscriber")
	creature := func(collection, author int) int {
		return d.id(`INSERT INTO character_sheets (owner_id, collection_id, author_id)
SELECT owner_id, id, $2 FROM bestiary_collections WHERE id = $1`, collection, author)
	}
	public := func(owner int, name string) int {
		return d.id(`INSERT INTO bestiary_collections (owner_id, name, visibility, published_at) VALUES ($1, $2, 'public', now())`, owner, name)
	}
	defaultOf := func(user int) int {
		return d.int(`SELECT id FROM bestiary_collections WHERE owner_id = $1 AND is_default`, user)
	}

	private := defaultOf(leaver)
	privateCreature := creature(private, leaver)
	subscribed := public(leaver, "subscribed")
	subscribedCreature := creature(subscribed, leaver)
	d.exec(`INSERT INTO bestiary_subscriptions (user_id, collection_id) VALUES ($1, $2)`, subscriber, subscribed)
	unsubscribed := public(leaver, "unsubscribed")
	// The subscriber's copy of the leaver's creature, and the leaver's subscription to another's.
	copied := d.id(`INSERT INTO character_sheets (owner_id, collection_id, author_id, source_sheet_id, source_label) VALUES ($1, $2, $3, $4, 'subscribed · leaver')`,
		subscriber, defaultOf(subscriber), leaver, subscribedCreature)
	theirs := public(subscriber, "theirs")
	d.exec(`INSERT INTO bestiary_subscriptions (user_id, collection_id) VALUES ($1, $2)`, leaver, theirs)

	d.schedule(leaver, false, false, false, nil)
	d.wipe(leaver)
	for _, id := range []int{private, unsubscribed} {
		if d.exists(`SELECT 1 FROM bestiary_collections WHERE id = $1`, id) {
			t.Errorf("collection %d stays", id)
		}
	}
	if d.exists(`SELECT 1 FROM character_sheets WHERE id = $1`, privateCreature) {
		t.Error("a creature of the private collection stays")
	}
	if !d.exists(`SELECT 1 FROM bestiary_collections WHERE id = $1 AND owner_id = $2`, subscribed, leaver) {
		t.Error("the public collection with a subscriber is gone")
	}
	if d.exists(`SELECT 1 FROM character_sheets WHERE id = ANY($1) AND author_id IS NOT NULL`, []int{subscribedCreature, copied}) {
		t.Error("a creature or a copy keeps the leaver as its author")
	}
	assert.Equal(t, d.text(`SELECT source_label FROM character_sheets WHERE id = $1`, copied), "subscribed · leaver")
	if d.exists(`SELECT 1 FROM bestiary_subscriptions WHERE user_id = $1`, leaver) {
		t.Error("the leaver's subscription stays")
	}

	// With the box ticked every public collection goes, those with subscribers too.
	allSubscribed := public(all, "all")
	d.exec(`INSERT INTO bestiary_subscriptions (user_id, collection_id) VALUES ($1, $2)`, subscriber, allSubscribed)
	d.schedule(all, false, false, true, nil)
	d.wipe(all)
	if d.exists(`SELECT 1 FROM bestiary_collections WHERE owner_id = $1`, all) {
		t.Error("a collection stays with the box ticked")
	}
}

func TestWipeForum(t *testing.T) {
	d := newWipeDB(t)
	wiping, keeping, other := d.user("wiping"), d.user("keeping"), d.user("other")
	section := d.int(`SELECT min(id) FROM forum_sections`)
	topic := func(author int, title string) int {
		return d.id(`INSERT INTO forum_topics (section_id, author_id, title) VALUES ($1, $2, $3)`, section, author, title)
	}
	post := func(topic, author int) int {
		return d.id(`INSERT INTO forum_posts (topic_id, author_id, body) VALUES ($1, $2, 'text')`, topic, author)
	}
	notify := func(user int, kind string, topic, post int, params string) int {
		return d.id(`INSERT INTO forum_notifications (user_id, kind, topic_id, post_id, params) VALUES ($1, $2, $3, NULLIF($4, 0), $5)`,
			user, kind, topic, post, params)
	}

	// A topic only the user wrote in, with a moderator's rename in the log, and one with a reply
	// of another after the user's reply that quotes them.
	own := topic(wiping, "own")
	post(own, wiping)
	ownNotice := notify(other, "replies", own, 0, `{"title": "own"}`)
	logged := d.id(`INSERT INTO forum_mod_log (moderator_id, action, topic_id, data) VALUES ($1, 'topic.rename', $2, '{"title": "older"}')`, other, own)
	shared := topic(other, "shared")
	post(shared, other)
	reply := post(shared, wiping)
	post(shared, other)
	d.exec(`UPDATE forum_topics SET reply_count = 2 WHERE id = $1`, shared)
	quote := notify(other, "quote", shared, reply, `{"title": "shared", "name": "wiping"}`)
	// What is the user's own on the forum.
	d.exec(`INSERT INTO forum_profiles (user_id, about) VALUES ($1, 'me')`, wiping)
	d.exec(`INSERT INTO forum_subscriptions (user_id, topic_id) VALUES ($1, $2)`, wiping, shared)
	d.exec(`INSERT INTO forum_topic_reads (user_id, topic_id, last_read_post_id) VALUES ($1, $2, $3)`, wiping, shared, reply)
	d.exec(`INSERT INTO forum_read_marks (user_id, post_id) VALUES ($1, $2)`, wiping, reply)
	d.exec(`INSERT INTO forum_moderators (user_id) VALUES ($1)`, wiping)
	d.exec(`INSERT INTO forum_bans (user_id, moderator_id, reason) VALUES ($1, $2, 'r')`, wiping, other)
	notify(wiping, "replies", shared, reply, `{"title": "shared"}`)

	d.schedule(wiping, false, true, false, nil)
	d.wipe(wiping)
	assert.Equal(t, d.text(`SELECT title FROM forum_topics WHERE id = $1`, own), "")
	if !d.exists(`SELECT 1 FROM forum_topics WHERE id = $1 AND deleted_at IS NOT NULL`, own) {
		t.Error("the topic only the user wrote in is not deleted")
	}
	assert.Equal(t, d.text(`SELECT params->>'title' FROM forum_notifications WHERE id = $1`, ownNotice), "")
	assert.Equal(t, d.text(`SELECT data::text FROM forum_mod_log WHERE id = $1`, logged), `{"title": "older"}`)
	assert.Equal(t, d.text(`SELECT title FROM forum_topics WHERE id = $1`, shared), "shared")
	if !d.exists(`SELECT 1 FROM forum_posts WHERE id = $1 AND body = '' AND deleted_at IS NOT NULL`, reply) {
		t.Error("the user's reply keeps its text or stands")
	}
	assert.Equal(t, d.int(`SELECT reply_count FROM forum_topics WHERE id = $1`, shared), 1)
	assert.Equal(t, d.text(`SELECT params->>'name' FROM forum_notifications WHERE id = $1`, quote), "")
	assert.Equal(t, d.text(`SELECT params->>'title' FROM forum_notifications WHERE id = $1`, quote), "shared")
	for _, table := range []string{"forum_profiles", "forum_subscriptions", "forum_topic_reads", "forum_read_marks", "forum_moderators", "forum_bans", "forum_notifications"} {
		assert.Equal(t, d.int(`SELECT count(*) FROM `+table+` WHERE user_id = $1`, wiping), 0)
	}

	// Without the box the posts stay as they were; the name leaves the quote notification all
	// the same.
	kept := topic(keeping, "kept")
	keptPost := post(kept, keeping)
	keptQuote := notify(other, "quote", kept, keptPost, `{"title": "kept", "name": "keeping"}`)
	d.schedule(keeping, false, false, false, nil)
	d.wipe(keeping)
	assert.Equal(t, d.text(`SELECT title FROM forum_topics WHERE id = $1`, kept), "kept")
	if !d.exists(`SELECT 1 FROM forum_posts WHERE id = $1 AND body = 'text' AND deleted_at IS NULL`, keptPost) {
		t.Error("the post changed without the box")
	}
	assert.Equal(t, d.text(`SELECT params->>'name' FROM forum_notifications WHERE id = $1`, keptQuote), "")
}

func TestWipeTombstone(t *testing.T) {
	d := newWipeDB(t)
	leaver, gm, bystander := d.user("leaver"), d.user("gm"), d.user("bystander")
	hash, err := bcrypt.GenerateFromPassword([]byte("pa$$word"), bcrypt.MinCost)
	assert.NilError(t, err)
	d.exec(`UPDATE users SET hashed_password = $2, locale = 'ru' WHERE id = $1`, leaver, string(hash))
	room := d.room(gm, roomMember{gm, RoleGamemaster}, roomMember{leaver, RolePlayer})
	d.exec(`INSERT INTO dice_presets (room_id, user_id, slot_number, dice_notation) VALUES ($1, $2, 1, '1d10')`, room, leaver)
	d.exec(`INSERT INTO tokens (hash, user_id, expiry, scope) VALUES ('\x01', $1, now() + interval '1 day', 'cancel_deletion')`, leaver)
	d.exec(`INSERT INTO user_avatars (user_id, hash, mime, data) VALUES ($1, 'a', 'image/webp', '\x00')`, leaver)
	d.exec(`INSERT INTO user_avatar_locks (user_id, reason, moderator_id) VALUES ($1, 'r', $2)`, leaver, gm)
	d.exec(`INSERT INTO data_exports (user_id, state, file_name) VALUES ($1, 'ready', 'export.zip')`, leaver)

	m := UserModel{DB: d.db}
	// Nothing scheduled: nothing to do.
	if _, err := m.Wipe(d.ctx, bystander); !errors.Is(err, ErrNoRecord) {
		t.Errorf("wipe of an account not deleting: %v", err)
	}
	assert.Equal(t, d.text(`SELECT name FROM users WHERE id = $1`, bystander), "bystander")

	d.schedule(leaver, false, false, false, nil)
	w := d.wipe(leaver)
	assert.Equal(t, w.Email, "leaver@example.com")
	assert.Equal(t, w.Name, "leaver")
	assert.Equal(t, w.Locale, "ru")
	assert.Equal(t, w.ExportFile, "export.zip")

	var status, name, email, hashed string
	var locale *string
	var deletedAt *time.Time
	err = d.db.QueryRow(d.ctx, `SELECT status::text, name, email, hashed_password, locale, deleted_at FROM users WHERE id = $1`, leaver).
		Scan(&status, &name, &email, &hashed, &locale, &deletedAt)
	assert.NilError(t, err)
	assert.Equal(t, status, string(statusDeleted))
	assert.Equal(t, name, "")
	if email == "leaver@example.com" || !strings.HasPrefix(email, "deleted-") {
		t.Errorf("email %q", email)
	}
	assert.Equal(t, hashed, strings.Repeat("!", 60))
	if locale != nil || deletedAt == nil {
		t.Errorf("locale %v, deleted_at %v", locale, deletedAt)
	}
	for _, table := range []string{"room_members", "dice_presets", "tokens", "user_avatars", "user_avatar_locks", "data_exports"} {
		assert.Equal(t, d.int(`SELECT count(*) FROM `+table+` WHERE user_id = $1`, leaver), 0)
	}

	if _, err := m.Authenticate(d.ctx, "leaver@example.com", "pa$$word"); !errors.Is(err, ErrInvalidCredentials) {
		t.Errorf("Authenticate: %v", err)
	}
	if _, err := m.Authenticate(d.ctx, email, strings.Repeat("!", 60)); !errors.Is(err, ErrInvalidCredentials) {
		t.Errorf("Authenticate with the tombstone's email: %v", err)
	}
	exists, err := m.Exists(d.ctx, leaver)
	assert.NilError(t, err)
	assert.Equal(t, exists, false)
	if _, err := m.Get(d.ctx, leaver); !errors.Is(err, ErrNoRecord) {
		t.Errorf("Get: %v", err)
	}
	if _, err := m.GetByEmail(d.ctx, email); !errors.Is(err, ErrNoRecord) {
		t.Errorf("GetByEmail: %v", err)
	}
	if _, err := m.GetLocale(d.ctx, leaver); !errors.Is(err, ErrNoRecord) {
		t.Errorf("GetLocale: %v", err)
	}

	// The row stays as the log of the deletion, and a second wipe finds nothing to do.
	if !d.exists(`SELECT 1 FROM account_deletions WHERE user_id = $1 AND wiped_at IS NOT NULL`, leaver) {
		t.Error("the deletion row is gone or not marked wiped")
	}
	if _, err := m.Wipe(d.ctx, leaver); !errors.Is(err, ErrNoRecord) {
		t.Errorf("second wipe: %v", err)
	}
}

func TestDeletePending(t *testing.T) {
	d := newWipeDB(t)
	account := func(name, status string, age int) int {
		id := d.user(name)
		d.exec(`UPDATE users SET status = $2, created_at = now() - make_interval(days => $3) WHERE id = $1`, id, status, age)
		d.exec(`INSERT INTO tokens (hash, user_id, expiry, scope) VALUES (convert_to($2, 'UTF8'), $1, now() + interval '1 day', 'verification')`, id, name)
		return id
	}
	old, young, confirmed := account("old", "pending", 31), account("young", "pending", 29), account("confirmed", "email_verified", 31)

	m := UserModel{DB: d.db}
	n, err := m.DeletePending(d.ctx, 30*24*time.Hour)
	assert.NilError(t, err)
	assert.Equal(t, n, int64(1))
	if d.exists(`SELECT 1 FROM users WHERE id = $1`, old) ||
		d.exists(`SELECT 1 FROM bestiary_collections WHERE owner_id = $1`, old) ||
		d.exists(`SELECT 1 FROM tokens WHERE user_id = $1`, old) {
		t.Error("the old pending account or its rows stay")
	}
	for _, id := range []int{young, confirmed} {
		if !d.exists(`SELECT 1 FROM users WHERE id = $1`, id) {
			t.Errorf("user %d deleted", id)
		}
	}
}

func TestAuthenticateStatuses(t *testing.T) {
	if testing.Short() {
		t.Skip("models: skipping integration test")
	}
	db := newTestDB(t)
	ctx := context.Background()
	m := UserModel{db}
	hash, err := bcrypt.GenerateFromPassword([]byte("pa$$word"), bcrypt.MinCost)
	assert.NilError(t, err)

	tests := []struct {
		status userStatus
		want   error
	}{
		{statusEmailVerified, nil},
		{statusPending, ErrUserNotActivated},
		{"disabled", ErrUserNotActivated},
		{statusDeleting, ErrDeletionScheduled},
	}
	for _, tt := range tests {
		t.Run(string(tt.status), func(t *testing.T) {
			email := string(tt.status) + "@example.com"
			var id int
			err := db.QueryRow(ctx, `INSERT INTO users (name, email, hashed_password, status) VALUES ('u', $1, $2, $3) RETURNING id`,
				email, string(hash), tt.status).Scan(&id)
			assert.NilError(t, err)

			// A wrong password says nothing of the status.
			if _, err := m.Authenticate(ctx, email, "wrong"); !errors.Is(err, ErrInvalidCredentials) {
				t.Errorf("wrong password: %v", err)
			}
			got, err := m.Authenticate(ctx, email, "pa$$word")
			if !errors.Is(err, tt.want) || (tt.want == nil && err != nil) {
				t.Errorf("right password: %v, want %v", err, tt.want)
			}
			assert.Equal(t, got, id)

			// Only a confirmed account has a session.
			_, err = m.GetLocale(ctx, id)
			if (tt.status == statusEmailVerified) != (err == nil) {
				t.Errorf("GetLocale: %v", err)
			}
		})
	}
}
