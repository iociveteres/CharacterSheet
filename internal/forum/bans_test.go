package forum

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"github.com/jackc/pgx/v5/pgxpool"
)

func liftURL(banID int) string { return fmt.Sprintf("%s/%d/lift", bansURL, banID) }

// banRecord is a row of forum_bans.
type banRecord struct {
	ID          int
	UserID      int
	ModeratorID int
	Reason      string
	CreatedAt   time.Time
	ExpiresAt   *time.Time
	LiftedAt    *time.Time
	LiftedBy    *int
}

func bans(t *testing.T, db *pgxpool.Pool) []banRecord {
	t.Helper()
	var list []banRecord
	rows, err := db.Query(context.Background(), `
		SELECT id, user_id, moderator_id, reason, created_at, expires_at, lifted_at, lifted_by FROM forum_bans ORDER BY id`)
	assert.NilError(t, err)
	defer rows.Close()
	for rows.Next() {
		var b banRecord
		assert.NilError(t, rows.Scan(&b.ID, &b.UserID, &b.ModeratorID, &b.Reason, &b.CreatedAt, &b.ExpiresAt, &b.LiftedAt, &b.LiftedBy))
		list = append(list, b)
	}
	assert.NilError(t, rows.Err())
	return list
}

func insertBan(t *testing.T, db *pgxpool.Pool, userID, moderatorID int) int {
	t.Helper()
	var id int
	err := db.QueryRow(context.Background(), `
		INSERT INTO forum_bans (user_id, moderator_id, reason) VALUES ($1, $2, 'spam') RETURNING id`, userID, moderatorID).Scan(&id)
	assert.NilError(t, err)
	return id
}

// fixedNow makes the forum's clock stand at the time.
func fixedNow(f *Forum, now time.Time) {
	f.now = func() time.Time { return now }
}

// banScene is a topic of alice with her reply, which a moderator may ban her for.
type banScene struct {
	db                    *pgxpool.Pool
	h                     *testHost
	f                     *Forum
	alice, mod            int
	section, topic, reply int
}

func newBanScene(t *testing.T) banScene {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	s := banScene{db: db, h: h, f: f}
	s.alice = forumtest.User(t, db, "alice", at(0))
	s.mod = newModerator(t, db, "mod")
	s.section = newSection(t, db, "section")
	s.topic, _ = mustCreateTopic(t, f, s.section, s.alice, "title", at(1))
	s.reply = mustReply(t, f, s.topic, s.alice, "reply", at(2))
	return s
}

// A ban ends by itself at its expires_at, with nothing written: the user writes again, the notice
// and the line of the list are gone, and lifting it changes nothing.
func TestBanExpires(t *testing.T) {
	s := newBanScene(t)
	fixedNow(s.f, at(10))
	s.h.userID = s.mod
	redirectedTo(t, s.h.post(t, s.f, deleteURL(s.reply), banForm("1", "spam")))
	banID := bans(t, s.db)[0].ID
	topicURL := fmt.Sprintf("/forum/topic/%d", s.topic)

	end := at(10).AddDate(0, 0, 1)
	fixedNow(s.f, end.Add(-time.Minute))
	s.h.get(t, s.f, bansURL)
	assert.StringContains(t, string(s.h.page.Body), fmt.Sprintf(`id="ban-%d"`, banID))
	s.h.userID = s.alice
	s.h.get(t, s.f, topicURL)
	assert.StringContains(t, string(s.h.page.Body), "forum-ban-notice")
	assert.Equal(t, s.h.post(t, s.f, topicURL+"/reply", url.Values{"body": {"text"}}).Code, http.StatusForbidden)

	fixedNow(s.f, end)
	s.h.get(t, s.f, topicURL)
	assert.Equal(t, strings.Contains(string(s.h.page.Body), "forum-ban-notice"), false)
	assert.StringContains(t, string(s.h.page.Body), `id="reply"`)
	redirectedTo(t, s.h.post(t, s.f, topicURL+"/reply", url.Values{"body": {"text"}}))

	s.h.userID = s.mod
	s.h.get(t, s.f, bansURL)
	assert.Equal(t, strings.Contains(string(s.h.page.Body), `id="ban-`), false)
	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, liftURL(banID), url.Values{})), bansURL)
	assert.Equal(t, bans(t, s.db)[0].LiftedAt == nil, true)
	// The deletion and the ban; lifting the expired ban wrote nothing.
	assert.Equal(t, len(modLog(t, s.db)), 2)
}

// "Lift" ends a ban at once and writes the log; a second press changes nothing. Only moderators
// lift.
func TestLiftBan(t *testing.T) {
	s := newBanScene(t)
	banID := insertBan(t, s.db, s.alice, s.mod)

	s.h.userID = s.alice
	assert.Equal(t, s.h.post(t, s.f, liftURL(banID), url.Values{}).Code, http.StatusForbidden)
	s.h.userID = s.mod
	s.h.get(t, s.f, bansURL)
	assert.Equal(t, s.h.page.NoIndex, true)
	assert.StringContains(t, string(s.h.page.Body), `action="`+liftURL(banID)+`"`)

	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, liftURL(banID), url.Values{})), bansURL)
	b := bans(t, s.db)[0]
	assert.Equal(t, b.LiftedAt != nil, true)
	assert.Equal(t, *b.LiftedBy, s.mod)
	log := modLog(t, s.db)
	assert.Equal(t, len(log), 1)
	assert.Equal(t, log[0].Action, string(actionUnbanUser))
	assert.Equal(t, log[0].UserID, s.alice)
	assert.Equal[any](t, log[0].Data["banId"], float64(banID))

	redirectedTo(t, s.h.post(t, s.f, liftURL(banID), url.Values{}))
	assert.Equal(t, len(modLog(t, s.db)), 1)
	s.h.userID = s.alice
	v, _ := viewerOf(t, s.f)
	assert.Equal(t, v.Banned(), false)
}

// The banned user reads the home, a section and a topic with the notice of the ban on top and no
// form to write; a member and a banned moderator see no notice.
func TestBanNotice(t *testing.T) {
	s := newBanScene(t)
	insertBan(t, s.db, s.alice, s.mod)
	insertBan(t, s.db, s.mod, s.mod)
	bob := forumtest.User(t, s.db, "bob", at(0))
	pages := []string{"/forum/", fmt.Sprintf("/forum/section/%d", s.section), fmt.Sprintf("/forum/topic/%d", s.topic)}

	s.h.userID = s.alice
	for _, p := range pages {
		s.h.get(t, s.f, p)
		assert.Equal(t, s.h.status, http.StatusOK)
		body := string(s.h.page.Body)
		assert.StringContains(t, body, `class="forum-notice forum-ban-notice"`)
		// The reason is the moderator's own words, shown as typed.
		assert.StringContains(t, body, ": spam</span>")
		for _, form := range []string{`id="reply"`, "forum-new-topic", "forum-quote-post", "forum-edit-post", "forum-delete-post"} {
			assert.Equal(t, strings.Contains(body, form), false)
		}
	}
	for _, viewer := range []int{bob, s.mod} {
		s.h.userID = viewer
		for _, p := range pages {
			s.h.get(t, s.f, p)
			assert.Equal(t, strings.Contains(string(s.h.page.Body), "forum-ban-notice"), false)
		}
	}
}

// fillPattern turns a registered pattern into its method and an address: each wildcard takes the
// value the test gave for the segment before it ("topic/{id}"). A wildcard without one fails the
// test, so a new address needs its value here.
func fillPattern(t *testing.T, pattern string, values map[string]string) (method, path string) {
	t.Helper()
	method, path, ok := strings.Cut(pattern, " ")
	if !ok {
		return "", pattern
	}
	segments := strings.Split(path, "/")
	for i, seg := range segments {
		if seg == "{$}" {
			segments[i] = ""
			continue
		}
		if !strings.HasPrefix(seg, "{") {
			continue
		}
		value, ok := values[segments[i-1]+"/"+seg]
		if !ok {
			t.Fatalf("%s: no value for %s/%s in the test", pattern, segments[i-1], seg)
		}
		segments[i] = value
	}
	return method, strings.Join(segments, "/")
}

// forumState is everything the forum stores but the marks of reading, to see that nothing changed.
func forumState(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	var state []string
	for _, table := range []string{"forum_sections", "forum_moderators", "forum_topics", "forum_posts", "forum_bans", "forum_mod_log", "forum_subscriptions", "forum_notifications", "forum_profiles"} {
		var s string
		err := db.QueryRow(context.Background(),
			`SELECT COALESCE(string_agg(x::text, ',' ORDER BY x::text), '') FROM `+table+` x`).Scan(&s)
		assert.NilError(t, err)
		state = append(state, s)
	}
	return strings.Join(state, "\n")
}

// Every address of the forum that writes refuses a banned user with 403 and changes nothing. The
// test goes through the registered POST routes, so an address added without the check fails it.
// The moderators' addresses are in the list too: a banned user is no moderator, and a ban does not
// bind a moderator, so they refuse by the check of a moderator. The only exceptions are the user's
// own marks of reading, which a banned user keeps (the plan: a banned user is a guest plus their
// own state), and the view's density, which a guest sets too; the test checks that they still work.
func TestEveryWritingAddressRefusesBanned(t *testing.T) {
	s := newBanScene(t)
	other := newSection(t, s.db, "other")
	banID := insertBan(t, s.db, s.alice, s.mod)
	values := map[string]string{
		"section/{id}":  fmt.Sprint(s.section),
		"topic/{id}":    fmt.Sprint(s.topic),
		"post/{id}":     fmt.Sprint(s.reply),
		"mod/{action}":  string(topicRename),
		"sections/{id}": fmt.Sprint(s.section),
		"bans/{id}":     fmt.Sprint(banID),
		"user/{id}":     fmt.Sprint(s.alice),
		"log/{id}":      "1",
	}
	// Each field any form of the forum reads, valid, so that only the ban stands in the way.
	form := url.Values{
		"title": {"a new title"}, "body": {"text"}, "reason": {"reason"}, "name": {"name"},
		"direction": {"down"}, "section": {fmt.Sprint(other)}, "duration": {"7"}, "density": {"compact"},
		"ban": {"1"}, "recent": {"1"},
	}
	ownMarks := map[string]bool{"POST /forum/read": true, "POST /forum/section/{id}/read": true, "POST /forum/notifications/read": true,
		"POST /forum/view/density": true}

	s.h.userID = s.alice
	before := forumState(t, s.db)
	checked := 0
	for _, pattern := range s.f.patterns {
		method, path := fillPattern(t, pattern, values)
		if method != http.MethodPost {
			continue
		}
		if ownMarks[pattern] {
			delete(ownMarks, pattern)
			redirectedTo(t, s.h.post(t, s.f, path, form))
			continue
		}
		rec := s.h.post(t, s.f, path, form)
		if rec.Code != http.StatusForbidden {
			t.Errorf("POST %s (%s): status %d, want 403", path, pattern, rec.Code)
		}
		checked++
	}
	assert.Equal(t, forumState(t, s.db), before)
	// An exception that is no longer an address would hide nothing; drop it from the list.
	assert.Equal(t, len(ownMarks), 0)
	if checked < 10 {
		t.Errorf("only %d addresses checked", checked)
	}
}

// Every page of /forum/mod/ keeps out of search engines.
func TestModPagesNoIndex(t *testing.T) {
	s := newBanScene(t)
	s.h.userID = s.mod
	values := map[string]string{"sections/{id}": fmt.Sprint(s.section)}
	pages := 0
	for _, pattern := range s.f.patterns {
		if !strings.HasPrefix(pattern, "GET /forum/mod/") {
			continue
		}
		_, path := fillPattern(t, pattern, values)
		s.h.get(t, s.f, path)
		if s.h.status != http.StatusOK || !s.h.page.NoIndex {
			t.Errorf("GET %s: status %d, noindex %v", path, s.h.status, s.h.page.NoIndex)
		}
		pages++
	}
	assert.Equal(t, pages, 5)
}
