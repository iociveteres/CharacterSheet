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
)

// Unit tests check what the page holds by its classes and addresses, never its words: the texts are
// e2e's (extras/plan.md, «Правила»).

// userScene is banScene with bob, another member, who writes in alice's topic.
type userScene struct {
	banScene
	bob int
}

func newUserScene(t *testing.T) userScene {
	s := userScene{banScene: newBanScene(t)}
	s.bob = newUserOf(t, s, "bob")
	return s
}

func newUserOf(t *testing.T, s userScene, name string) int {
	t.Helper()
	var id int
	err := s.db.QueryRow(context.Background(), `INSERT INTO users (name, created_at) VALUES ($1, $2) RETURNING id`, name, at(0)).Scan(&id)
	assert.NilError(t, err)
	return id
}

// logOf is the actions of the log on the user, the oldest first, with their reasons and data.
func logOf(t *testing.T, s userScene, userID int) []string {
	t.Helper()
	rows, err := s.db.Query(context.Background(), `
		SELECT action || ' ' || reason || ' ' || data::text FROM forum_mod_log WHERE user_id = $1 ORDER BY id`, userID)
	assert.NilError(t, err)
	var lines []string
	for rows.Next() {
		var l string
		assert.NilError(t, rows.Scan(&l))
		lines = append(lines, l)
	}
	assert.NilError(t, rows.Err())
	return lines
}

func about(t *testing.T, s userScene, userID int) string {
	t.Helper()
	var text string
	err := s.db.QueryRow(context.Background(), `SELECT COALESCE((SELECT about FROM forum_profiles WHERE user_id = $1), '')`, userID).Scan(&text)
	assert.NilError(t, err)
	return text
}

func (s userScene) page(t *testing.T, viewer, userID int, query string) string {
	t.Helper()
	s.h.userID = viewer
	s.h.get(t, s.f, userURL(userID)+query)
	if s.h.status != http.StatusOK {
		t.Fatalf("GET %s%s as %d: status %d, not found %v", userURL(userID), query, viewer, s.h.status, s.h.notFound)
	}
	return string(s.h.page.Body)
}

// The page shows the user's posts and topics, the newest first, with the topic and section of each
// post; deleted ones only to a moderator, marked; and the counters of what each viewer finds.
func TestUserPage(t *testing.T) {
	s := newUserScene(t)
	fixedNow(s.f, at(30))
	other, _ := mustCreateTopic(t, s.f, s.section, s.bob, "bob's", at(3))
	gone := mustReply(t, s.f, other, s.alice, "> quoted words\n\ngone **reply**", at(4))
	deletePost(t, s.db, gone)
	last := mustReply(t, s.f, other, s.alice, "> quoted words\n\nlast **reply**", at(5))
	hidden, _ := mustCreateTopic(t, s.f, s.section, s.alice, "hidden", at(6))
	deleteTopic(t, s.db, hidden)

	for _, viewer := range []int{0, s.bob, s.alice} {
		body := s.page(t, viewer, s.alice, "")
		assert.Equal(t, s.h.page.NoIndex, true)
		assert.Equal(t, s.h.page.Canonical, "https://example.com"+userURL(s.alice))
		// Three posts a guest finds: the first of her topic, her reply and the last.
		assert.Equal(t, strings.Count(body, `<li class="forum-row`), 3)
		assert.Equal(t, strings.Contains(body, "forum-label deleted"), false)
		assert.Equal(t, strings.Contains(body, `class="forum-panel forum-user-mod"`), false)
		// The newest first; the line is the text without the quote and the Markdown.
		assert.Equal(t, strings.Index(body, postURL(last)) < strings.Index(body, postURL(s.reply)), true)
		assert.StringContains(t, body, `<span class="forum-user-excerpt">last reply</span>`)
		assert.Equal(t, strings.Contains(body, "quoted words"), false)
		assert.StringContains(t, body, ` · 3</a>`)
	}

	body := s.page(t, s.mod, s.alice, "")
	assert.Equal(t, strings.Count(body, `<li class="forum-row`), 5)
	assert.Equal(t, strings.Count(body, `<li class="forum-row deleted">`), 2)
	assert.StringContains(t, body, ` · 5</a>`)

	// Topics: hers, the deleted one to a moderator only, each naming its section.
	body = s.page(t, s.bob, s.alice, "?tab=topics")
	assert.Equal(t, strings.Count(body, `class="forum-row-title"`), 1)
	assert.StringContains(t, body, `<span class="meta">section · `)
	body = s.page(t, s.mod, s.alice, "?tab=topics")
	assert.Equal(t, strings.Count(body, `class="forum-row-title"`), 2)

	// Not found: no user, a tab that does not exist, ?tab=posts (the page has one address), a page
	// past the last, a page of nothing but the first.
	s.h.userID = 0
	for _, target := range []string{userURL(999), userURL(s.alice) + "?tab=x", userURL(s.alice) + "?tab=posts",
		userURL(s.alice) + "?page=2", userURL(s.bob) + "?tab=topics&page=2", "/forum/user/x"} {
		s.h.get(t, s.f, target)
		if !s.h.notFound {
			t.Errorf("GET %s: status %d, want not found", target, s.h.status)
		}
	}
	// A user without a post has the first page of each tab.
	s.page(t, 0, s.mod, "")
	s.page(t, 0, s.mod, "?tab=topics")
}

// The tabs have pages of twenty posts, and the links of the pages keep the tab.
func TestUserPagePages(t *testing.T) {
	s := newUserScene(t)
	for i := range 21 {
		mustCreateTopic(t, s.f, s.section, s.bob, fmt.Sprintf("topic %d", i), at(3+i))
	}
	body := s.page(t, 0, s.bob, "")
	assert.Equal(t, strings.Count(body, `<li class="forum-row`), userPostsPerPage)
	assert.StringContains(t, body, `href="`+userURL(s.bob)+`?page=2"`)
	body = s.page(t, 0, s.bob, "?page=2")
	assert.Equal(t, strings.Count(body, `<li class="forum-row`), 1)
	assert.Equal(t, s.h.page.Canonical, "https://example.com"+userURL(s.bob)+"?page=2")
	body = s.page(t, 0, s.bob, "?tab=topics")
	assert.Equal(t, strings.Count(body, `class="forum-row-title"`), 21)
}

// The head lists the last 10 former names under ▾, the latest first, to everyone; no ▾ without a
// history.
func TestUserPageFormerNames(t *testing.T) {
	s := newUserScene(t)
	assert.Equal(t, strings.Contains(s.page(t, 0, s.bob, ""), `class="former-names"`), false)

	for i := range 12 {
		_, err := s.db.Exec(context.Background(), `INSERT INTO user_name_history (user_id, name, changed_at) VALUES ($1, $2, $3)`,
			s.bob, fmt.Sprintf("bob-%02d", i), at(i))
		assert.NilError(t, err)
	}
	body := s.page(t, 0, s.bob, "")
	assert.StringContains(t, body, `class="former-names"`)
	newest, tenth := strings.Index(body, "bob-11"), strings.Index(body, "bob-02")
	if newest < 0 || tenth < newest {
		t.Errorf("not the latest first: bob-11 at %d, bob-02 at %d", newest, tenth)
	}
	assert.Equal(t, strings.Contains(body, "bob-01"), false)
	assert.StringContains(t, s.page(t, s.alice, s.bob, ""), "bob-11")
}

// The ban line of the head and the moderators' block: a moderator on another's page only (decision
// 20). The banned user reads the notice at the top instead; nobody else sees anything.
func TestUserPageBanLineAndModBlock(t *testing.T) {
	s := newUserScene(t)
	insertBan(t, s.db, s.alice, s.mod)
	for _, c := range []struct {
		name           string
		viewer, target int
		line, block    bool
		notice         bool
	}{
		{"guest", 0, s.alice, false, false, false},
		{"member", s.bob, s.alice, false, false, false},
		{"herself", s.alice, s.alice, false, false, true},
		{"moderator", s.mod, s.alice, true, true, false},
		{"moderator's own page", s.mod, s.mod, false, false, false},
	} {
		body := s.page(t, c.viewer, c.target, "")
		if got := strings.Contains(body, `forum-user-banned`); got != c.line {
			t.Errorf("%s: ban line %v", c.name, got)
		}
		if got := strings.Contains(body, `forum-user-mod"`); got != c.block {
			t.Errorf("%s: moderators' block %v", c.name, got)
		}
		if got := strings.Contains(body, `forum-ban-notice`); got != c.notice {
			t.Errorf("%s: ban notice %v", c.name, got)
		}
	}
	// Another moderator's page has the history only: no ban, avatar or «About» rows.
	other := newModerator(t, s.db, "other mod")
	body := s.page(t, s.mod, other, "")
	assert.StringContains(t, body, `forum-user-mod-row history`)
	for _, row := range []string{"forum-user-mod-ban", "forum-user-mod-avatar", "forum-user-mod-about"} {
		assert.Equal(t, strings.Contains(body, row), false)
	}
	// Her own page links the Account page, where the avatar changes.
	body = s.page(t, s.bob, s.bob, "")
	assert.StringContains(t, body, `href="`+s.h.AccountURL()+`"`)
}

// «About»: the user writes it on their own page and nobody else may; an empty one shows only to
// them; too long comes back with the form open; a ban takes the form away.
func TestAbout(t *testing.T) {
	s := newUserScene(t)
	fixedNow(s.f, at(30))
	target := userURL(s.bob) + "/about"

	body := s.page(t, s.bob, s.bob, "")
	assert.StringContains(t, body, `id="about"`)
	assert.StringContains(t, body, `action="`+target+`"`)
	assert.Equal(t, strings.Contains(s.page(t, s.alice, s.bob, ""), `id="about"`), false)

	s.h.userID = s.bob
	// The line breaks of a field come as CRLF and count one character each.
	text := "**dice** maker\r\n" + strings.Repeat("я", aboutMaxLength-15)
	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, target, url.Values{"about": {text}})), userURL(s.bob))
	assert.Equal(t, about(t, s, s.bob), strings.ReplaceAll(text, "\r\n", "\n"))
	for _, viewer := range []int{0, s.alice, s.mod} {
		body := s.page(t, viewer, s.bob, "")
		assert.StringContains(t, body, `<strong>dice</strong> maker`)
		assert.Equal(t, strings.Contains(body, `action="`+target+`"`), false)
	}

	s.h.userID = s.bob
	s.h.post(t, s.f, target, url.Values{"about": {text + "я"}})
	assert.Equal(t, s.h.status, http.StatusUnprocessableEntity)
	body = string(s.h.page.Body)
	assert.StringContains(t, body, `<details class="forum-user-form" open>`)
	assert.StringContains(t, body, `aria-invalid="true"`)
	assert.StringContains(t, body, `<span id="forum-about-count">501</span>`)
	assert.Equal(t, about(t, s, s.bob), strings.ReplaceAll(text, "\r\n", "\n"))

	// Emptied, it shows to nobody else again.
	redirectedTo(t, s.h.post(t, s.f, target, url.Values{"about": {"  "}}))
	assert.Equal(t, strings.Contains(s.page(t, 0, s.bob, ""), `id="about"`), false)

	// Another's page, a guest, a banned user: 403 and nothing written.
	for _, viewer := range []int{s.alice, s.mod, 0} {
		s.h.userID = viewer
		assert.Equal(t, s.h.post(t, s.f, target, url.Values{"about": {"mine"}}).Code, http.StatusForbidden)
	}
	insertBan(t, s.db, s.bob, s.mod)
	s.h.userID = s.bob
	assert.Equal(t, s.h.post(t, s.f, target, url.Values{"about": {"mine"}}).Code, http.StatusForbidden)
	assert.Equal(t, about(t, s, s.bob), "")
	assert.Equal(t, strings.Contains(s.page(t, s.bob, s.bob, ""), `action="`+target+`"`), false)
}

// A moderator erases «About» with a reason: the text goes, the log keeps the reason, the user is
// told and reads «erased» on their page until they write again.
func TestEraseAbout(t *testing.T) {
	s := newUserScene(t)
	fixedNow(s.f, at(30))
	_, err := s.db.Exec(context.Background(), `INSERT INTO forum_profiles (user_id, about, updated_at) VALUES ($1, 'buy dice', $2)`, s.bob, at(10))
	assert.NilError(t, err)
	target := userURL(s.bob) + "/about/erase"

	s.h.userID = s.mod
	s.h.post(t, s.f, target, url.Values{"reason": {" "}})
	assert.Equal(t, s.h.status, http.StatusUnprocessableEntity)
	assert.StringContains(t, string(s.h.page.Body), `<details class="forum-user-form" open>`)
	assert.Equal(t, about(t, s, s.bob), "buy dice")

	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, target, url.Values{"reason": {"advert"}})), userURL(s.bob))
	assert.Equal(t, about(t, s, s.bob), "")
	assert.Equal(t, strings.Join(logOf(t, s, s.bob), "\n"), "about.erase advert {}")
	assert.Equal(t, noticeList(t, s.db, s.bob), "about.erase topic=0 post=0 count=1 read=false")
	// Again: nothing to erase, nothing written.
	redirectedTo(t, s.h.post(t, s.f, target, url.Values{"reason": {"advert"}}))
	assert.Equal(t, len(logOf(t, s, s.bob)), 1)

	// He reads why on his page, and the moderator in the block; nobody else sees the block.
	assert.StringContains(t, s.page(t, s.bob, s.bob, ""), `forum-user-banned">`)
	assert.StringContains(t, s.page(t, s.mod, s.bob, ""), `forum-user-mod-about`)
	assert.Equal(t, strings.Contains(s.page(t, s.alice, s.bob, ""), `id="about"`), false)

	// Written again, «erased» goes.
	fixedNow(s.f, at(31))
	s.h.userID = s.bob
	redirectedTo(t, s.h.post(t, s.f, userURL(s.bob)+"/about", url.Values{"about": {""}}))
	assert.Equal(t, strings.Contains(s.page(t, s.bob, s.bob, ""), `forum-user-banned">`), false)

	// Only a moderator, never on their own page.
	for _, viewer := range []int{0, s.alice, s.bob} {
		s.h.userID = viewer
		assert.Equal(t, s.h.post(t, s.f, target, url.Values{"reason": {"x"}}).Code, http.StatusForbidden)
	}
	s.h.userID = s.mod
	assert.Equal(t, s.h.post(t, s.f, userURL(s.mod)+"/about/erase", url.Values{"reason": {"x"}}).Code, http.StatusForbidden)
	// Nor another moderator's.
	other := newModerator(t, s.db, "other mod")
	_, err = s.db.Exec(context.Background(), `INSERT INTO forum_profiles (user_id, about) VALUES ($1, 'mine')`, other)
	assert.NilError(t, err)
	assert.Equal(t, s.h.post(t, s.f, userURL(other)+"/about/erase", url.Values{"reason": {"x"}}).Code, http.StatusForbidden)
	assert.Equal(t, about(t, s, other), "mine")
}

// A moderator removes the avatar through the host, with a lock of a term, for good or none; then
// the forum writes its log line and notification. The host's error stops before the log.
func TestRemoveAvatar(t *testing.T) {
	s := newUserScene(t)
	now := at(30)
	fixedNow(s.f, now)
	target := userURL(s.bob) + "/avatar"
	s.h.avatarURLs = map[int]string{s.bob: "/avatar/b", s.alice: "/avatar/a"}

	body := s.page(t, s.mod, s.bob, "")
	assert.StringContains(t, body, `action="`+target+`"`)
	assert.Equal(t, strings.Count(body, `type="radio" name="lock"`), len(lockTerms))
	assert.StringContains(t, body, `value="none" checked`)

	s.h.userID = s.mod
	for _, form := range []url.Values{{"lock": {"7"}}, {"lock": {"1"}, "reason": {"advert"}}} {
		s.h.post(t, s.f, target, form)
		assert.Equal(t, s.h.status, http.StatusUnprocessableEntity)
	}
	assert.Equal(t, s.h.avatarURLs[s.bob], "/avatar/b")

	week := now.AddDate(0, 0, 7)
	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, target, url.Values{"lock": {"7"}, "reason": {"advert"}})), userURL(s.bob))
	assert.Equal(t, s.h.avatarURLs[s.bob], "")
	lock := s.h.avatarLocks[s.bob]
	assert.Equal(t, lock.Until.Equal(week), true)
	assert.Equal(t, lock.Reason, "advert")
	assert.Equal(t, lock.ModeratorID, s.mod)
	assert.Equal(t, strings.Join(logOf(t, s, s.bob), "\n"),
		`avatar.remove advert {"lock": "7", "lockUntil": "`+week.Format(time.RFC3339)+`"}`)
	assert.Equal(t, noticeList(t, s.db, s.bob), "avatar.remove topic=0 post=0 count=1 read=false")
	n := notices(t, s.db, s.bob)[0]
	assert.Equal(t, n.Params["lock"], "7")
	assert.Equal(t, n.Params["reason"], "advert")

	// Sent again, there is no avatar to remove: nothing more is written.
	redirectedTo(t, s.h.post(t, s.f, target, url.Values{"lock": {"30"}, "reason": {"advert"}}))
	assert.Equal(t, len(logOf(t, s, s.bob)), 1)

	// Without a lock and for good.
	redirectedTo(t, s.h.post(t, s.f, userURL(s.alice)+"/avatar", url.Values{"lock": {"none"}, "reason": {"r"}}))
	assert.Equal(t, s.h.avatarLocks[s.alice] == nil, true)
	s.h.avatarURLs[s.alice] = "/avatar/a2"
	redirectedTo(t, s.h.post(t, s.f, userURL(s.alice)+"/avatar", url.Values{"lock": {"forever"}, "reason": {"r"}}))
	assert.Equal(t, s.h.avatarLocks[s.alice].Until == nil, true)
	assert.Equal(t, strings.Join(logOf(t, s, s.alice), "\n"),
		"avatar.remove r {\"lock\": \"none\", \"lockUntil\": null}\navatar.remove r {\"lock\": \"forever\", \"lockUntil\": null}")

	// The host fails: a server error and no line.
	s.h.avatarURLs[s.alice] = "/avatar/a3"
	s.h.removeErr = fmt.Errorf("site down")
	req := httptest.NewRequest(http.MethodPost, userURL(s.alice)+"/avatar", strings.NewReader("lock=none&reason=r"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	s.h.err = nil
	s.f.Handler().ServeHTTP(httptest.NewRecorder(), req)
	assert.Equal(t, s.h.err, s.h.removeErr)
	assert.Equal(t, len(logOf(t, s, s.alice)), 2)
	s.h.removeErr = nil

	// Only a moderator, never on their own page; a guest too is refused.
	for _, viewer := range []int{0, s.alice} {
		s.h.userID = viewer
		assert.Equal(t, s.h.post(t, s.f, target, url.Values{"lock": {"none"}, "reason": {"x"}}).Code, http.StatusForbidden)
	}
	s.h.userID = s.mod
	assert.Equal(t, s.h.post(t, s.f, userURL(s.mod)+"/avatar", url.Values{"lock": {"none"}, "reason": {"x"}}).Code, http.StatusForbidden)
	// Nor another moderator's.
	other := newModerator(t, s.db, "other mod")
	s.h.avatarURLs[other] = "/avatar/o"
	assert.Equal(t, s.h.post(t, s.f, userURL(other)+"/avatar", url.Values{"lock": {"none"}, "reason": {"x"}}).Code, http.StatusForbidden)
	assert.Equal(t, s.h.avatarURLs[other], "/avatar/o")
}

// Lifting the lock, from the page or from the list of bans: the host lifts, the log and the user
// learn; without a lock nothing is written. The list of bans names the locks.
func TestLiftAvatarLock(t *testing.T) {
	s := newUserScene(t)
	fixedNow(s.f, at(30))
	until := at(30).AddDate(0, 0, 30)
	s.h.avatarLocks = map[int]*AvatarLock{s.bob: {UserID: s.bob, Until: &until, Reason: "advert", ModeratorID: s.mod, CreatedAt: at(20)}}

	s.h.userID = s.mod
	s.h.get(t, s.f, bansURL)
	body := string(s.h.page.Body)
	assert.StringContains(t, body, `<a class="forum-row-title" href="`+userURL(s.bob)+`">bob</a>`)
	assert.StringContains(t, body, `action="`+userURL(s.bob)+`/lift-avatar-lock"`)
	assert.StringContains(t, body, `<input type="hidden" name="back" value="bans">`)
	assert.StringContains(t, s.page(t, s.mod, s.bob, ""), `forum-lift-lock`)

	target := userURL(s.bob) + "/lift-avatar-lock"
	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, target, url.Values{"back": {"bans"}})), bansURL)
	assert.Equal(t, s.h.avatarLocks[s.bob] == nil, true)
	assert.Equal(t, strings.Join(logOf(t, s, s.bob), "\n"), `avatar.unlock  {"lockUntil": "`+until.Format(time.RFC3339)+`"}`)
	assert.Equal(t, noticeList(t, s.db, s.bob), "avatar.unlock topic=0 post=0 count=1 read=false")

	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, target, nil)), userURL(s.bob))
	assert.Equal(t, len(logOf(t, s, s.bob)), 1)

	s.h.userID = s.alice
	assert.Equal(t, s.h.post(t, s.f, target, nil).Code, http.StatusForbidden)
}

// The ban of the page: a term and a reason, a ban without a post, then «Lift the ban», which lifts
// whatever binds. A moderator is not banned.
func TestBanFromUserPage(t *testing.T) {
	s := newUserScene(t)
	fixedNow(s.f, at(30))
	target := userURL(s.bob) + "/ban"

	body := s.page(t, s.mod, s.bob, "")
	assert.Equal(t, strings.Count(body, `type="radio" name="duration"`), len(banDays))
	assert.StringContains(t, body, `value="1" checked`)

	s.h.userID = s.mod
	s.h.post(t, s.f, target, url.Values{"duration": {"7"}})
	assert.Equal(t, s.h.status, http.StatusUnprocessableEntity)
	s.h.post(t, s.f, target, url.Values{"duration": {"2"}, "reason": {"spam"}})
	assert.Equal(t, s.h.status, http.StatusUnprocessableEntity)
	assert.Equal(t, len(bans(t, s.db)), 0)

	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, target, url.Values{"duration": {"7"}, "reason": {"spam"}})), userURL(s.bob))
	list := bans(t, s.db)
	assert.Equal(t, len(list), 1)
	assert.Equal(t, list[0].UserID, s.bob)
	assert.Equal(t, list[0].ExpiresAt.Equal(at(30).AddDate(0, 0, 7)), true)
	var postID *int
	assert.NilError(t, s.db.QueryRow(context.Background(), `SELECT post_id FROM forum_mod_log WHERE action = 'user.ban'`).Scan(&postID))
	assert.Equal(t, postID == nil, true)
	assert.Equal(t, noticeList(t, s.db, s.bob), "user.ban topic=0 post=0 count=1 read=false")
	assert.StringContains(t, s.page(t, s.mod, s.bob, ""), `action="`+userURL(s.bob)+`/lift-ban"`)

	insertBan(t, s.db, s.bob, s.mod)
	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, userURL(s.bob)+"/lift-ban", nil)), userURL(s.bob))
	for _, b := range bans(t, s.db) {
		assert.Equal(t, b.LiftedAt != nil, true)
	}
	assert.Equal(t, logOf(t, s, s.bob)[1][:len("user.unban")], "user.unban")
	// Nothing binds: nothing written.
	redirectedTo(t, s.h.post(t, s.f, userURL(s.bob)+"/lift-ban", nil))
	assert.Equal(t, len(logOf(t, s, s.bob)), 2)

	other := newModerator(t, s.db, "other mod")
	for _, path := range []string{"/ban", "/lift-ban"} {
		assert.Equal(t, s.h.post(t, s.f, userURL(other)+path, url.Values{"duration": {"7"}, "reason": {"x"}}).Code, http.StatusForbidden)
	}
	s.h.userID = s.alice
	assert.Equal(t, s.h.post(t, s.f, target, url.Values{"duration": {"7"}, "reason": {"x"}}).Code, http.StatusForbidden)
}

// The log on one user (?user=): their lines only, the pages keep the filter; the moderators'
// block shows the last five.
func TestModLogOfUser(t *testing.T) {
	s := newUserScene(t)
	fixedNow(s.f, at(30))
	s.h.userID = s.mod
	for i := range 6 {
		redirectedTo(t, s.h.post(t, s.f, userURL(s.bob)+"/ban", url.Values{"duration": {"1"}, "reason": {fmt.Sprintf("r%d", i)}}))
		redirectedTo(t, s.h.post(t, s.f, userURL(s.bob)+"/lift-ban", nil))
	}
	redirectedTo(t, s.h.post(t, s.f, userURL(s.alice)+"/ban", url.Values{"duration": {"1"}, "reason": {"alice"}}))

	s.h.get(t, s.f, modLogURL+fmt.Sprintf("?user=%d", s.bob))
	body := string(s.h.page.Body)
	assert.Equal(t, strings.Count(body, `<li class="forum-row" id="log-`), 12)
	assert.Equal(t, strings.Contains(body, "alice"), false)
	assert.Equal(t, s.h.page.NoIndex, true)

	body = s.page(t, s.mod, s.bob, "")
	assert.Equal(t, strings.Count(body[strings.Index(body, `class="forum-user-log"`):], "<li>"), userHistoryLength)
	assert.StringContains(t, body, fmt.Sprintf(`href="/forum/mod/log?user=%d"`, s.bob))

	for _, q := range []string{"?user=x", "?user=0", "?user=999"} {
		s.h.get(t, s.f, modLogURL+q)
		if !s.h.notFound {
			t.Errorf("%s: found", q)
		}
	}
	assert.Equal(t, pageURL(modLogURL+"?user=5", 2), modLogURL+"?user=5&page=2")
}

// Every name the forum writes links to the page of its user: the author column, the line of a
// deleted post, the lists of topics, the home's last post, the head of a topic, the log, the bans.
func TestNamesLinkToUserPages(t *testing.T) {
	s := newUserScene(t)
	fixedNow(s.f, at(30))
	mustReply(t, s.f, s.topic, s.bob, "bob's reply", at(5))
	link := func(id int, name string) string {
		return fmt.Sprintf(`href="%s">%s</a>`, userURL(id), name)
	}
	s.h.userID = 0
	s.h.get(t, s.f, Topic{ID: s.topic}.URL())
	body := string(s.h.page.Body)
	assert.StringContains(t, body, `<a class="name" `+link(s.bob, "bob"))
	assert.StringContains(t, body, `<a class="forum-author-name" `+link(s.alice, "alice"))
	s.h.get(t, s.f, Section{ID: s.section}.URL())
	body = string(s.h.page.Body)
	assert.StringContains(t, body, link(s.alice, "alice"))
	assert.StringContains(t, body, link(s.bob, "bob"))
	s.h.get(t, s.f, "/forum/")
	assert.StringContains(t, string(s.h.page.Body), link(s.bob, "bob"))

	s.h.userID = s.mod
	redirectedTo(t, s.h.post(t, s.f, userURL(s.bob)+"/ban", url.Values{"duration": {"1"}, "reason": {"r"}}))
	s.h.get(t, s.f, modLogURL)
	body = string(s.h.page.Body)
	assert.StringContains(t, body, link(s.mod, "mod"))
	assert.StringContains(t, body, link(s.bob, "bob"))
	s.h.get(t, s.f, bansURL)
	body = string(s.h.page.Body)
	assert.StringContains(t, body, link(s.mod, "mod"))
	assert.StringContains(t, body, link(s.bob, "bob"))

	// «Deleted: who» of a deleted post, in the topic and on the page that restores it, and of a
	// deleted topic: the moderator who deleted it (the author's choice, extras/decisions.md, 32).
	note := func(body, class string) string {
		at := strings.Index(body, class)
		if at < 0 {
			t.Fatalf("no %s", class)
		}
		// The line, up to the end of its element.
		return body[at : at+strings.Index(body[at:], "</div>")]
	}
	redirectedTo(t, s.h.post(t, s.f, postURL(s.reply)+"/delete", url.Values{"reason": {"r"}}))
	s.h.get(t, s.f, Topic{ID: s.topic}.URL())
	assert.StringContains(t, note(string(s.h.page.Body), `class="deleted-note"`), link(s.mod, "mod"))
	s.h.get(t, s.f, postURL(s.reply)+"/restore")
	assert.StringContains(t, note(string(s.h.page.Body), `class="deleted-note"`), link(s.mod, "mod"))
	redirectedTo(t, s.h.post(t, s.f, Topic{ID: s.topic}.URL()+"/mod/delete", url.Values{"reason": {"r"}}))
	s.h.get(t, s.f, Topic{ID: s.topic}.URL())
	assert.StringContains(t, note(string(s.h.page.Body), `forum-deleted-notice`), link(s.mod, "mod"))
}

// Every form of a user page refuses a moderator acting on another moderator (the author's answer of
// 2026-11-20): no ban, no avatar removed, no «About» erased or written. The test goes through the
// registered routes, so an action added without the check fails it. Lifting a lock on the avatar
// only gives back and stays allowed.
func TestUserActionsRefuseModeratorOnModerator(t *testing.T) {
	s := newUserScene(t)
	other := newModerator(t, s.db, "other mod")
	_, err := s.db.Exec(context.Background(), `INSERT INTO forum_profiles (user_id, about) VALUES ($1, 'mine')`, other)
	assert.NilError(t, err)
	s.h.avatarURLs = map[int]string{other: "/avatar/o"}
	form := url.Values{"reason": {"r"}, "duration": {"1"}, "lock": {"forever"}, "about": {"theirs"}}
	allowed := map[string]bool{"POST /forum/user/{id}/lift-avatar-lock": true}

	s.h.userID = s.mod
	before := forumState(t, s.db)
	checked := 0
	for _, pattern := range s.f.patterns {
		if !strings.HasPrefix(pattern, "POST /forum/user/{id}/") {
			continue
		}
		_, path := fillPattern(t, pattern, map[string]string{"user/{id}": fmt.Sprint(other)})
		rec := s.h.post(t, s.f, path, form)
		if allowed[pattern] {
			redirectedTo(t, rec)
			continue
		}
		if rec.Code != http.StatusForbidden {
			t.Errorf("POST %s: status %d, want 403", path, rec.Code)
		}
		checked++
	}
	assert.Equal(t, forumState(t, s.db), before)
	assert.Equal(t, about(t, s, other), "mine")
	assert.Equal(t, s.h.avatarURLs[other], "/avatar/o")
	assert.Equal(t, checked, 5)
}
