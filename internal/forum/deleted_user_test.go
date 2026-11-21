package forum

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A deleted account stays in the forum as a tombstone: its id with an empty name
// (_prd/account_deletion/plan.md, 3). These tests check where the pages show it: by classes and
// addresses, never by words.

// wipeForumUser does to the user what the wipe of their account does to the forum and to their
// users row.
func wipeForumUser(t *testing.T, db *pgxpool.Pool, userID int, posts bool, when time.Time) {
	t.Helper()
	ctx := context.Background()
	tx, err := db.Begin(ctx)
	assert.NilError(t, err)
	defer tx.Rollback(ctx)
	assert.NilError(t, WipeUser(ctx, tx, userID, posts, when))
	_, err = tx.Exec(ctx, `UPDATE users SET name = '', status = 'deleted', deleted_at = $2 WHERE id = $1`, userID, when)
	assert.NilError(t, err)
	assert.NilError(t, tx.Commit(ctx))
}

// assertNoDeletedName fails if the page links to the user's page or writes an empty name.
func assertNoDeletedName(t *testing.T, page string, userID int, where string) {
	t.Helper()
	if strings.Contains(page, `href="`+userURL(userID)+`"`) {
		t.Errorf("%s: a link to the page of the deleted user", where)
	}
	if strings.Contains(page, `deleted-user"></span>`) {
		t.Errorf("%s: an empty name", where)
	}
}

// The page of a deleted user is not found, nor are its forms, while the log of moderators' actions
// on them stays readable.
func TestDeletedUserHasNoPage(t *testing.T) {
	s := newUserScene(t)
	fixedNow(s.f, at(10))
	s.h.userID = s.mod
	redirectedTo(t, s.h.post(t, s.f, userURL(s.bob)+"/ban", url.Values{"duration": {"1"}, "reason": {"spam"}}))
	s.h.get(t, s.f, userURL(s.bob))
	assert.Equal(t, s.h.found(t, userURL(s.bob)), true)

	wipeForumUser(t, s.db, s.bob, false, at(11))
	s.h.get(t, s.f, userURL(s.bob))
	assert.Equal(t, s.h.found(t, userURL(s.bob)), false)
	s.h.userID = 0
	s.h.get(t, s.f, userURL(s.bob))
	assert.Equal(t, s.h.found(t, userURL(s.bob)), false)

	s.h.userID = s.mod
	s.h.post(t, s.f, userURL(s.bob)+"/ban", url.Values{"duration": {"1"}, "reason": {"again"}})
	assert.Equal(t, s.h.notFound, true)

	logURL := fmt.Sprintf("%s?user=%d", modLogURL, s.bob)
	s.h.get(t, s.f, logURL)
	assert.Equal(t, s.h.found(t, logURL), true)
	page := string(s.h.page.Body)
	assert.StringContains(t, page, `class="forum-author-name deleted-user"`)
	assertNoDeletedName(t, page, s.bob, logURL)
	if s.h.page.Title == "" || strings.HasSuffix(s.h.page.Title, ": ") {
		t.Errorf("log of the deleted user: title %q", s.h.page.Title)
	}
}

// Posts a deleted user left stand with neither a link to their page nor an initial in the avatar:
// on the topic, in the last column of the section and the home, in the moderator's delete window,
// which offers no ban of the author, and in a quote of their post.
func TestDeletedAuthorWithoutLink(t *testing.T) {
	s := newUserScene(t)
	bobs := mustReply(t, s.f, s.topic, s.bob, "bob's words", at(3))
	wipeForumUser(t, s.db, s.bob, false, at(4))
	topicURL := fmt.Sprintf("/forum/topic/%d", s.topic)
	sectionURL := fmt.Sprintf("/forum/section/%d", s.section)

	for _, viewer := range []int{0, s.alice, s.mod} {
		s.h.userID = viewer
		for _, target := range []string{topicURL, sectionURL, "/forum/"} {
			s.h.get(t, s.f, target)
			assert.Equal(t, s.h.found(t, target), true)
			assertNoDeletedName(t, string(s.h.page.Body), s.bob, target)
		}
	}

	// The post of bob keeps its place, with a name that is not a link and an avatar without a letter.
	s.h.userID = s.alice
	s.h.get(t, s.f, topicURL)
	page := string(s.h.page.Body)
	i := strings.Index(page, fmt.Sprintf(`id="post-%d"`, bobs))
	if i < 0 {
		t.Fatal("no post of the deleted user")
	}
	card := page[i : i+strings.Index(page[i:], "</article>")]
	assert.StringContains(t, card, `<span class="name deleted-user">`)
	if !regexp.MustCompile(`<span class="forum-avatar letter[^"]*" aria-hidden="true"></span>`).MatchString(card) {
		t.Errorf("the avatar of the deleted user has a letter: %s", card)
	}
	// The quote of the post writes a name, not an empty one.
	if head := regexp.MustCompile(`data-quote-head="&gt; \*\*([^*]*)\*\*`).FindStringSubmatch(card); head == nil || head[1] == "" {
		t.Errorf("quote head of the deleted user's post: %v", head)
	}
	// The section's last column shows bob, without a link.
	s.h.get(t, s.f, sectionURL)
	assert.StringContains(t, string(s.h.page.Body), `class="forum-author-name deleted-user"`)

	// The moderator deletes the post with no block of the author, and a form that bans anyway is refused.
	s.h.userID = s.mod
	s.h.get(t, s.f, deleteURL(bobs))
	if strings.Contains(string(s.h.page.Body), "forum-delete-author") {
		t.Error("the delete window offers to act on the deleted author")
	}
	rec := s.h.post(t, s.f, deleteURL(bobs), banForm("1", "spam"))
	assert.Equal(t, rec.Code, 403)
	assert.Equal(t, readPost(t, s.db, bobs).deletedAt == nil, true)
	redirectedTo(t, s.h.post(t, s.f, deleteURL(bobs), url.Values{"reason": {"spam"}}))
	assert.Equal(t, readPost(t, s.db, bobs).deletedAt != nil, true)
}

// A ban a deleted moderator gave stays and reads in the list of bans and on the page of the banned,
// with no link to the moderator; so does the log line.
func TestBansOfDeletedModerator(t *testing.T) {
	s := newUserScene(t)
	other := newModerator(t, s.db, "other")
	fixedNow(s.f, at(10))
	s.h.userID = s.mod
	redirectedTo(t, s.h.post(t, s.f, deleteURL(s.reply), banForm("0", "spam")))
	wipeForumUser(t, s.db, s.mod, false, at(11))
	assert.Equal(t, len(bans(t, s.db)), 1)
	banID := bans(t, s.db)[0].ID

	s.h.userID = other
	for _, target := range []string{bansURL, userURL(s.alice), modLogURL} {
		s.h.get(t, s.f, target)
		assert.Equal(t, s.h.found(t, target), true)
		page := string(s.h.page.Body)
		assert.StringContains(t, page, `class="forum-author-name deleted-user"`)
		assertNoDeletedName(t, page, s.mod, target)
	}
	s.h.get(t, s.f, bansURL)
	assert.StringContains(t, string(s.h.page.Body), fmt.Sprintf(`id="ban-%d"`, banID))
}

// A topic its author erased whole with their account keeps an empty title, which the moderator's
// pages still word.
func TestErasedTopicTitle(t *testing.T) {
	s := newUserScene(t)
	topic, _ := mustCreateTopic(t, s.f, s.section, s.bob, "bob's topic", at(3))
	wipeForumUser(t, s.db, s.bob, true, at(4))
	assert.Equal(t, readTopic(t, s.db, topic).Title, "")

	s.h.userID = s.mod
	topicURL := fmt.Sprintf("/forum/topic/%d", topic)
	s.h.get(t, s.f, topicURL)
	assert.Equal(t, s.h.found(t, topicURL), true)
	if s.h.page.Title == "" || regexp.MustCompile(`<h2>\s*(<|$)`).MatchString(string(s.h.page.Body)) {
		t.Errorf("erased topic: title %q", s.h.page.Title)
	}
	sectionURL := fmt.Sprintf("/forum/section/%d", s.section)
	s.h.get(t, s.f, sectionURL)
	row := regexp.MustCompile(fmt.Sprintf(`<a class="forum-row-title" href="/forum/topic/%d[^"]*">([^<]*)</a>`, topic)).
		FindStringSubmatch(string(s.h.page.Body))
	if row == nil || row[1] == "" {
		t.Errorf("erased topic in the section: %v", row)
	}
}

// The parameters of a notification's text never leave a name or a title empty; the ones that are
// there stay as they are.
func TestShownParams(t *testing.T) {
	for _, lang := range []string{"en", "ru"} {
		got := shownParams(lang, map[string]any{"name": "", "title": "", "reason": "spam"})
		if got["name"] == "" || got["title"] == "" || got["reason"] != "spam" {
			t.Errorf("%s: %v", lang, got)
		}
		got = shownParams(lang, map[string]any{"name": "bob", "title": "Orks"})
		if got["name"] != "bob" || got["title"] != "Orks" {
			t.Errorf("%s: %v", lang, got)
		}
		if _, ok := shownParams(lang, map[string]any{"count": 2})["name"]; ok {
			t.Errorf("%s: a name where the row has none", lang)
		}
	}
}

// A quote notification whose quoting author deleted the account still shows on the page, worded.
func TestQuoteNotificationOfDeletedUser(t *testing.T) {
	s := newUserScene(t)
	mustReply(t, s.f, s.topic, s.bob, quoteOf("alice", s.reply)+"answer", at(3))
	wipeForumUser(t, s.db, s.bob, false, at(4))
	var name string
	err := s.db.QueryRow(context.Background(), `
		SELECT params->>'name' FROM forum_notifications WHERE user_id = $1 AND kind = $2`, s.alice, string(notifyQuote)).Scan(&name)
	assert.NilError(t, err)
	assert.Equal(t, name, "")

	s.h.userID = s.alice
	s.h.get(t, s.f, notificationsURL)
	assert.Equal(t, len(notificationLines(t, s.h)), 1)
}
