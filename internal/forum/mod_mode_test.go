package forum

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

// The moderator mode (_prd/forum/moderator-mode/plan.md). The pages are checked by their classes and
// addresses, never their words.

// The item of «Moderation ▾» and «Turn off» of the strip keep the mode in the cookie and send the
// browser back; nobody but a moderator gets it.
func TestSetModMode(t *testing.T) {
	s := newBanScene(t)
	s.h.userID = s.mod
	tests := []struct {
		name, mode, redirect, wantLocation, wantValue string
		wantKept                                      bool
	}{
		{"on", "on", "/forum/", "/forum/", "on", true},
		{"off back to a topic", "off", "/forum/topic/3?page=2", "/forum/topic/3?page=2", "", false},
		{"redirect off the forum", "on", "/account/view", "/forum/", "on", true},
		{"redirect to another host", "on", "/forum//evil.example", "/forum/", "on", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := s.h.post(t, s.f, "/forum/view/mod-mode", url.Values{"mode": {tt.mode}, "redirect": {tt.redirect}})
			assert.Equal(t, redirectedTo(t, rec), tt.wantLocation)
			cookies := rec.Result().Cookies()
			assert.Equal(t, len(cookies), 1)
			c := cookies[0]
			assert.Equal(t, c.Name, modModeCookie)
			assert.Equal(t, c.Value, tt.wantValue)
			assert.Equal(t, c.Path, "/forum")
			assert.Equal(t, c.HttpOnly, true)
			assert.Equal(t, c.SameSite, http.SameSiteLaxMode)
			if tt.wantKept {
				assert.Equal(t, c.MaxAge, 365*24*60*60)
			} else if c.MaxAge >= 0 {
				t.Errorf("MaxAge %d, want the cookie deleted", c.MaxAge)
			}
		})
	}

	rec := s.h.post(t, s.f, "/forum/view/mod-mode", url.Values{"mode": {"maybe"}})
	assert.Equal(t, rec.Code, http.StatusBadRequest)
	assert.Equal(t, len(rec.Result().Cookies()), 0)

	// A member and a guest get 403 and no cookie.
	for _, viewer := range []int{s.alice, 0} {
		s.h.userID = viewer
		rec := s.h.post(t, s.f, "/forum/view/mod-mode", url.Values{"mode": {"on"}})
		assert.Equal(t, rec.Code, http.StatusForbidden)
		assert.Equal(t, len(rec.Result().Cookies()), 0)
	}
}

// modModeScene: in a closed topic of alice, bob's reply deleted and alice's reply standing; a
// deleted topic in the same section; a news section, topics by moderators only; alice banned.
type modModeScene struct {
	userScene
	gone, deletedTopic, news int
}

func newModModeScene(t *testing.T) modModeScene {
	s := modModeScene{userScene: newUserScene(t)}
	fixedNow(s.f, at(30))
	s.gone = mustReply(t, s.f, s.topic, s.bob, "gone words", at(3))
	deletePost(t, s.db, s.gone)
	closeTopic(t, s.db, s.topic)
	s.deletedTopic, _ = mustCreateTopic(t, s.f, s.section, s.alice, "deleted topic", at(4))
	deleteTopic(t, s.db, s.deletedTopic)
	err := s.db.QueryRow(context.Background(), `
		INSERT INTO forum_sections (name, position, mods_only_topics) VALUES ('news', 100, true) RETURNING id`).Scan(&s.news)
	assert.NilError(t, err)
	insertBan(t, s.db, s.alice, s.mod)
	return s
}

func (s modModeScene) body(t *testing.T, viewer int, modeOff bool, target string) string {
	t.Helper()
	s.h.userID, s.h.modModeOff = viewer, modeOff
	s.h.get(t, s.f, target)
	if s.h.status != http.StatusOK {
		t.Fatalf("GET %s as %d: status %d, not found %v", target, viewer, s.h.status, s.h.notFound)
	}
	return string(s.h.page.Body)
}

// Out of the mode a moderator sees the pages members see as a member does; in it, what moderators
// see. A member with the cookie sees a member's pages either way.
func TestModModePages(t *testing.T) {
	s := newModModeScene(t)
	topic := fmt.Sprintf("/forum/topic/%d", s.topic)
	section := fmt.Sprintf("/forum/section/%d", s.section)
	news := fmt.Sprintf("/forum/section/%d", s.news)

	// What moderators see, by page; each is in the page in the mode and gone out of it.
	moderators := []struct {
		name, target, mark string
	}{
		{"deleted topic in the section", section, `>deleted topic</a>`},
		{"new topic in the news", news, `class="f-btn f-primary forum-new-topic"`},
		{"topic's menu", topic, `href="` + topic + `/mod/rename"`},
		{"deleted post's text", topic, "gone words"},
		{"deleted post's card", topic, "deleted-mod"},
		{"restore", topic, `href="` + postURL(s.gone) + `/restore"`},
		{"delete another's", topic, `href="` + deleteURL(s.reply) + `"`},
		{"quote in a closed topic", topic, `href="` + postURL(s.reply) + `/quote#reply"`},
		{"reply in a closed topic", topic, `id="reply"`},
		{"ban line", userURL(s.alice), "forum-user-banned"},
		{"moderators' block", userURL(s.alice), `class="forum-panel forum-user-mod"`},
		{"deleted post in the tab", userURL(s.bob), `<li class="forum-row deleted">`},
		{"strip", topic, `class="forum-mod-mode"`},
	}
	for _, m := range moderators {
		if !strings.Contains(s.body(t, s.mod, false, m.target), m.mark) {
			t.Errorf("%s: missing in the mode", m.name)
		}
		if strings.Contains(s.body(t, s.mod, true, m.target), m.mark) {
			t.Errorf("%s: shown out of the mode", m.name)
		}
		if strings.Contains(s.body(t, s.alice, false, m.target), m.mark) {
			t.Errorf("%s: shown to a member with the cookie", m.name)
		}
	}

	// Out of the mode a deleted post is the line members see, and the counts are theirs.
	body := s.body(t, s.mod, true, topic)
	assert.StringContains(t, body, "deleted-stub")
	assert.StringContains(t, s.body(t, s.mod, true, userURL(s.bob)), ` · 0</a>`)
	assert.StringContains(t, s.body(t, s.mod, false, userURL(s.bob)), ` · 1</a>`)

	// The home keeps «Moderation ▾» at any mode, its item telling the mode and turning it over.
	body = s.body(t, s.mod, true, "/forum/")
	assert.StringContains(t, body, `href="/forum/mod/log"`)
	assert.StringContains(t, body, `name="mode" value="on"`)
	assert.StringContains(t, body, `aria-pressed="false"`)
	assert.Equal(t, strings.Contains(body, `class="forum-mod-mode"`), false)
	body = s.body(t, s.mod, false, "/forum/")
	assert.StringContains(t, body, `name="mode" value="off" class="forum-menu-toggle forum-mod-mode-toggle" aria-pressed="true"`)
	assert.Equal(t, strings.Contains(s.body(t, s.alice, false, "/forum/"), "/forum/view/mod-mode"), false)

	// A moderator's ban, from before the grant, does not come back out of the mode.
	insertBan(t, s.db, s.mod, s.mod)
	assert.Equal(t, strings.Contains(s.body(t, s.mod, true, topic), "forum-ban-notice"), false)

	// «Turn off» comes back to the page it is on, its query kept.
	body = s.body(t, s.mod, false, userURL(s.bob)+"?tab=topics")
	assert.StringContains(t, body, `name="redirect" value="`+userURL(s.bob)+`?tab=topics"`)
}

// The pages only moderators reach show as in the mode, out of it too: the moderators' pages, the
// windows of a post and a deleted topic; the strip is on every page while the mode is on.
func TestModModeModeratorsPages(t *testing.T) {
	s := newModModeScene(t)
	deleted := fmt.Sprintf("/forum/topic/%d", s.deletedTopic)
	body := s.body(t, s.mod, true, deleted)
	assert.StringContains(t, body, "forum-deleted-notice")
	assert.StringContains(t, body, `href="`+deleted+`/mod/restore"`)
	assert.StringContains(t, s.body(t, s.mod, true, postURL(s.gone)+"/restore"), "gone words")
	s.body(t, s.mod, true, "/forum/mod/log")

	values := map[string]string{
		"section/{id}":  fmt.Sprint(s.section),
		"topic/{id}":    fmt.Sprint(s.topic),
		"post/{id}":     fmt.Sprint(s.reply),
		"mod/{action}":  string(topicRename),
		"sections/{id}": fmt.Sprint(s.section),
		"user/{id}":     fmt.Sprint(s.alice),
	}
	seen := 0
	for _, pattern := range s.f.patterns {
		if !strings.HasPrefix(pattern, "GET ") {
			continue
		}
		_, path := fillPattern(t, pattern, values)
		if pattern == "GET /forum/post/{id}/restore" {
			path = postURL(s.gone) + "/restore"
		}
		if pattern == "GET /forum/topic/{id}/mod/{action}" {
			// The closed topic has no «close»; rename is any topic's.
			path = fmt.Sprintf("/forum/topic/%d/mod/%s", s.topic, topicRename)
		}
		for _, off := range []bool{false, true} {
			s.h.userID, s.h.modModeOff = s.mod, off
			s.h.get(t, s.f, path)
			if s.h.status != http.StatusOK {
				continue // a redirect, or an action this topic has not
			}
			if got := strings.Contains(string(s.h.page.Body), `class="forum-mod-mode"`); got == off {
				t.Errorf("GET %s, mode off %v: strip %v", path, off, got)
			}
			seen++
		}
	}
	if seen < 30 {
		t.Errorf("only %d pages seen", seen)
	}
}

// Out of the mode the actions still go through by their addresses: rights are the role's.
func TestModModeActionsByAddress(t *testing.T) {
	s := newModModeScene(t)
	s.h.userID, s.h.modModeOff = s.mod, true
	topic := fmt.Sprintf("/forum/topic/%d", s.topic)

	redirectedTo(t, s.h.post(t, s.f, topic+"/reply", url.Values{"body": {"a moderator's word"}}))
	redirectedTo(t, s.h.post(t, s.f, deleteURL(s.reply), url.Values{"reason": {"spam"}}))
	redirectedTo(t, s.h.post(t, s.f, modURL(s.topic, topicOpen), url.Values{"reason": {"again"}}))
	redirectedTo(t, s.h.post(t, s.f, userURL(s.bob)+"/ban", url.Values{"duration": {"1"}, "reason": {"spam"}}))
	redirectedTo(t, s.h.post(t, s.f, fmt.Sprintf("/forum/section/%d/new", s.news), url.Values{"title": {"news"}, "body": {"text"}}))

	var replies, deleted, bans, newsTopics int
	var closed bool
	err := s.db.QueryRow(context.Background(), `
		SELECT (SELECT count(*) FROM forum_posts WHERE topic_id = $1),
		       (SELECT count(*) FROM forum_posts WHERE id = $2 AND deleted_at IS NOT NULL),
		       (SELECT closed FROM forum_topics WHERE id = $1),
		       (SELECT count(*) FROM forum_bans WHERE user_id = $3),
		       (SELECT count(*) FROM forum_topics WHERE section_id = $4)`,
		s.topic, s.reply, s.bob, s.news).Scan(&replies, &deleted, &closed, &bans, &newsTopics)
	assert.NilError(t, err)
	assert.Equal(t, replies, 4)
	assert.Equal(t, deleted, 1)
	assert.Equal(t, closed, false)
	assert.Equal(t, bans, 1)
	assert.Equal(t, newsTopics, 1)

	// A reply brought back with its error shows its form, which the page out of the mode would not.
	closeTopic(t, s.db, s.topic)
	s.h.post(t, s.f, topic+"/reply", url.Values{"body": {""}})
	assert.Equal(t, s.h.status, http.StatusUnprocessableEntity)
	assert.StringContains(t, string(s.h.page.Body), `id="reply"`)
	// So does a moderator's form of the user page.
	s.h.post(t, s.f, userURL(s.alice)+"/lift-ban", nil)
	s.h.post(t, s.f, userURL(s.alice)+"/ban", url.Values{"duration": {"1"}})
	assert.Equal(t, s.h.status, http.StatusUnprocessableEntity)
	assert.StringContains(t, string(s.h.page.Body), `class="forum-panel forum-user-mod"`)
}
