package forum

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/i18n"
)

// unreadOf is the unread notifications of the user as one string, one per line.
func unreadOf(t *testing.T, s notifyScene, userID int) string {
	t.Helper()
	var lines []string
	for _, n := range notices(t, s.db, userID) {
		if !n.Read {
			lines = append(lines, n.String())
		}
	}
	return strings.Join(lines, "\n")
}

// Reading a page of the topic reads the notifications of what it shows: a quote on it, and the
// replies once nothing past the page is left — until then they move to the first reply past it and
// count only what is left (task 6.4).
func TestReadingTopicReadsItsNotifications(t *testing.T) {
	s := newNotifyScene(t)
	// Twenty-five replies of bob: page 1 ends on the 19th, page 2 holds the rest. The 22nd
	// quotes alice and is a quote, not a reply, for her.
	replies := []int{}
	for i := range 25 {
		body := fmt.Sprintf("reply %d", i)
		if i == 21 {
			body = quoteOf("alice", s.first) + body
		}
		replies = append(replies, mustReply(t, s.f, s.topic, s.bob, body, at(2+i)))
	}
	assert.Equal(t, unreadOf(t, s, s.alice), fmt.Sprintf(
		"replies topic=%d post=%d count=24 read=false\nquote topic=%d post=%d count=1 read=false",
		s.topic, replies[0], s.topic, replies[21]))

	// Page 1 shows the first post and 19 replies: 6 are left, the 22nd among them.
	s.h.userID = s.alice
	page := fmt.Sprintf("/forum/topic/%d", s.topic)
	s.h.get(t, s.f, page)
	assert.Equal(t, unreadOf(t, s, s.alice), fmt.Sprintf(
		"replies topic=%d post=%d count=6 read=false\nquote topic=%d post=%d count=1 read=false",
		s.topic, replies[19], s.topic, replies[21]))

	// Going back to page 1 changes nothing; page 2 reads both.
	s.h.get(t, s.f, page)
	assert.Equal(t, len(strings.Split(unreadOf(t, s, s.alice), "\n")), 2)
	s.h.get(t, s.f, page+"?page=2")
	assert.Equal(t, unreadOf(t, s, s.alice), "")

	// What is left past the read post is the posts of others that are not deleted; alice's own
	// reply reads the topic up to it and leaves nothing.
	next := mustReply(t, s.f, s.topic, s.bob, "one more", at(30))
	carols := mustReply(t, s.f, s.topic, s.carol, "and another", at(31))
	deletePost(t, s.db, mustReply(t, s.f, s.topic, s.bob, "deleted", at(32)))
	assert.Equal(t, unreadOf(t, s, s.alice), fmt.Sprintf("replies topic=%d post=%d count=3 read=false", s.topic, next))
	assert.NilError(t, readTopicUpTo(context.Background(), s.db, s.alice, s.topic, next, at(33)))
	assert.Equal(t, unreadOf(t, s, s.alice), fmt.Sprintf("replies topic=%d post=%d count=1 read=false", s.topic, carols))
	mustReply(t, s.f, s.topic, s.bob, "the last", at(34))
	assert.Equal(t, unreadOf(t, s, s.alice), fmt.Sprintf("replies topic=%d post=%d count=2 read=false", s.topic, carols))
	mustReply(t, s.f, s.topic, s.alice, "alice answers", at(35))
	assert.Equal(t, unreadOf(t, s, s.alice), "")

	// A moderator's notification of the topic is read on the page of notifications, not here.
	s.h.userID = s.mod
	s.h.post(t, s.f, modURL(s.topic, topicClose), url.Values{})
	s.h.userID = s.alice
	s.h.get(t, s.f, page+"?page=2")
	assert.Equal(t, unreadOf(t, s, s.alice), fmt.Sprintf("topic.close topic=%d post=0 count=1 read=false", s.topic))
}

// notificationLines are the rows of the page of notifications the host got last: whether each is
// unread, its link and whether it has a reason.
func notificationLines(t *testing.T, h *testHost) []string {
	t.Helper()
	body := string(h.page.Body)
	var lines []string
	for _, item := range strings.Split(body, `<li class="forum-row`)[1:] {
		line := "read"
		if strings.HasPrefix(item, ` unread"`) {
			line = "unread"
		}
		if i := strings.Index(item, `class="note-text" href="`); i >= 0 {
			rest := item[i+len(`class="note-text" href="`):]
			line += " " + rest[:strings.Index(rest, `"`)]
		} else {
			line += " -"
		}
		if strings.Contains(item, "note-reason") {
			line += " reason"
		}
		// Every parameter of the text is filled and every key is in the catalog.
		if strings.Contains(item, "{") || strings.Contains(item, "forum.") {
			t.Errorf("unworded notification: %s", item)
		}
		lines = append(lines, line)
	}
	return lines
}

// The page shows every kind in the reader's language, the newest first, with a link while the
// viewer may read the topic; a moderator's notification is read once shown, the others stay.
func TestNotificationsPage(t *testing.T) {
	s := newNotifyScene(t)
	ctx := context.Background()
	gone, gonePost := mustCreateTopic(t, s.f, s.section, s.alice, "gone", at(1))
	deleteTopic(t, s.db, gone)
	week := at(0).AddDate(0, 0, 7).Format(time.RFC3339)
	// From the oldest: [kind, topic, post, params].
	rows := []struct {
		kind        string
		topic, post int
		params      string
	}{
		{"replies", s.topic, s.first, `{"title": "title"}`},
		{"quote", s.topic, s.first, `{"title": "title", "name": "bob"}`},
		{"post.delete", s.topic, s.first, `{"title": "title", "reason": "rude"}`},
		{"post.restore", s.topic, s.first, `{"title": "title"}`},
		{"topic.rename", s.topic, 0, `{"title": "title", "oldTitle": "old"}`},
		{"topic.close", s.topic, 0, `{"title": "title", "reason": "done"}`},
		{"topic.open", s.topic, 0, `{"title": "title"}`},
		{"topic.move", s.topic, 0, `{"title": "title", "section": "other"}`},
		{"topic.delete", gone, 0, `{"title": "gone", "reason": "spam"}`},
		{"topic.restore", s.topic, 0, `{"title": "title"}`},
		{"user.ban", gone, gonePost, `{"title": "gone", "reason": "spam", "expiresAt": "` + week + `"}`},
		{"user.ban", s.topic, s.first, `{"title": "title", "reason": "again", "expiresAt": null}`},
		{"user.unban", 0, 0, `{}`},
	}
	for i, r := range rows {
		_, err := s.db.Exec(ctx, `
			INSERT INTO forum_notifications (user_id, kind, topic_id, post_id, count, params, created_at, updated_at)
			VALUES ($1, $2, NULLIF($3, 0), NULLIF($4, 0), 3, $5, $6, $6)`,
			s.carol, r.kind, r.topic, r.post, r.params, at(10+i))
		assert.NilError(t, err)
	}
	topic, post := Topic{ID: s.topic}.URL(), postURL(s.first)
	// The newest first.
	want := []string{
		"unread -",
		"unread " + post + " reason",
		"unread - reason", // the topic of the post is deleted
		"unread " + topic,
		"unread - reason",
		"unread " + topic,
		"unread " + topic,
		"unread " + topic + " reason",
		"unread " + topic,
		"unread " + post,
		"unread " + post + " reason",
		"unread " + post,
		"unread " + post,
	}

	// A guest signs in first.
	rec := s.h.get(t, s.f, notificationsURL)
	assert.Equal(t, rec.Code, http.StatusSeeOther)

	s.h.userID = s.carol
	for _, lang := range []string{"en", "ru"} {
		_, err := s.db.Exec(ctx, `UPDATE forum_notifications SET read_at = NULL WHERE user_id = $1`, s.carol)
		assert.NilError(t, err)
		getIn(t, s, notificationsURL, lang)
		assert.Equal(t, s.h.status, http.StatusOK)
		assert.Equal(t, s.h.page.NoIndex, true)
		assert.Equal(t, strings.Join(notificationLines(t, s.h), "\n"), strings.Join(want, "\n"))
		// Shown once as unread, the moderators' notifications are read; replies and the quote
		// wait for the topic.
		assert.Equal(t, unreadOf(t, s, s.carol), fmt.Sprintf(
			"replies topic=%d post=%d count=3 read=false\nquote topic=%d post=%d count=3 read=false",
			s.topic, s.first, s.topic, s.first))
	}

	// A moderator reads a deleted topic, so its notification links to it.
	_, err := s.db.Exec(ctx, `UPDATE forum_notifications SET user_id = $1 WHERE user_id = $2`, s.mod, s.carol)
	assert.NilError(t, err)
	s.h.userID = s.mod
	s.h.get(t, s.f, notificationsURL)
	lines := notificationLines(t, s.h)
	assert.Equal(t, lines[2], "read "+postURL(gonePost)+" reason")
	assert.Equal(t, lines[4], "read "+Topic{ID: gone}.URL()+" reason")
}

// getIn serves target to the viewer of the host in the language.
func getIn(t *testing.T, s notifyScene, target, lang string) *httptest.ResponseRecorder {
	t.Helper()
	s.h.err, s.h.status, s.h.page, s.h.notFound = nil, 0, Page{}, false
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	s.f.Handler().ServeHTTP(rec, req.WithContext(i18n.WithLang(req.Context(), lang)))
	if s.h.err != nil {
		t.Fatalf("GET %s: %v", target, s.h.err)
	}
	return rec
}

// «Mark all as read» reads every kind; a guest, who has no page, is refused.
func TestReadAllNotifications(t *testing.T) {
	s := newNotifyScene(t)
	mustReply(t, s.f, s.topic, s.bob, quoteOf("alice", s.first)+"a quote", at(2))
	mustReply(t, s.f, s.topic, s.carol, "a reply", at(3))
	s.h.userID = s.mod
	s.h.post(t, s.f, modURL(s.topic, topicClose), url.Values{})
	assert.Equal(t, len(strings.Split(unreadOf(t, s, s.alice), "\n")), 3)

	s.h.userID = 0
	rec := s.h.post(t, s.f, "/forum/notifications/read", url.Values{})
	assert.Equal(t, rec.Code, http.StatusForbidden)
	s.h.userID = s.alice
	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, "/forum/notifications/read", url.Values{})), notificationsURL)
	assert.Equal(t, unreadOf(t, s, s.alice), "")
}

// The page of notifications goes by pages of notificationsPerPage; past the last it is not found,
// and an empty first page is a page.
func TestNotificationsPages(t *testing.T) {
	s := newNotifyScene(t)
	s.h.userID = s.bob
	s.h.get(t, s.f, notificationsURL)
	assert.Equal(t, s.h.found(t, notificationsURL), true)
	assert.Equal(t, len(notificationLines(t, s.h)), 0)

	_, err := s.db.Exec(context.Background(), `
		INSERT INTO forum_notifications (user_id, kind, params, updated_at)
		SELECT $1, 'user.unban', '{}', $2::timestamptz + i * interval '1 minute' FROM generate_series(1, $3) i`,
		s.bob, at(0), notificationsPerPage+1)
	assert.NilError(t, err)
	for page, n := range map[int]int{1: notificationsPerPage, 2: 1, 3: -1} {
		target := fmt.Sprintf("%s?page=%d", notificationsURL, page)
		s.h.get(t, s.f, target)
		if !s.h.found(t, target) {
			assert.Equal(t, n, -1)
			continue
		}
		assert.Equal(t, len(notificationLines(t, s.h)), n)
	}
}

// The button «Notifications» of the forum home carries the same pill as the nav: the number, "9+"
// past nine, none at zero; a guest has no button.
func TestHomeNotificationsButton(t *testing.T) {
	s := newNotifyScene(t)
	button := func() string {
		t.Helper()
		s.h.get(t, s.f, "/forum/")
		body := string(s.h.page.Body)
		i := strings.Index(body, `class="f-btn f-secondary forum-notifications"`)
		if i < 0 {
			return "none"
		}
		body = body[i : strings.Index(body[i:], "</a>")+i]
		if j := strings.Index(body, `class="nav-badge"`); j >= 0 {
			body = body[j:]
			return body[strings.Index(body, ">")+1 : strings.Index(body, "</span>")]
		}
		return ""
	}
	assert.Equal(t, button(), "none")
	s.h.userID = s.alice
	assert.Equal(t, button(), "")
	for i := range 10 {
		mustReply(t, s.f, s.topic, s.bob, quoteOf("alice", s.first)+"quote", at(2+i))
	}
	assert.Equal(t, button(), "9&#43;")
	readNotices(t, s.db, s.alice)
	mustReply(t, s.f, s.topic, s.bob, "one", at(20))
	mustReply(t, s.f, s.topic, s.bob, "two", at(21))
	assert.Equal(t, button(), "1")
}
