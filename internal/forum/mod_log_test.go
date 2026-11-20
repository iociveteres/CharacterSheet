package forum

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
)

// Every action of the log is worded from the catalog, not shown as its code.
func TestLogActionsWorded(t *testing.T) {
	for _, a := range []modAction{
		actionRenameTopic, actionPinTopic, actionUnpinTopic, actionCloseTopic, actionOpenTopic,
		actionMoveTopic, actionDeleteTopic, actionRestoreTopic, actionDeletePost, actionRestorePost,
		actionCreateSection, actionEditSection, actionMoveSection, actionBanUser, actionUnbanUser,
		actionRemoveAvatar, actionUnlockAvatar, actionEraseAbout,
	} {
		for _, lang := range []string{"en", "ru"} {
			if got := (logLine{Action: a}).ActionText(lang); got == string(a) || got == "" {
				t.Errorf("%s in %s: %q", a, lang, got)
			}
		}
	}
	assert.Equal(t, logLine{Action: "topic.someday"}.ActionText("en"), "topic.someday")
}

// The log shows each action, the newest first, with a link to its target as it is now: a topic, a
// post, a section, the post a ban was given for; a deleted topic still links, with its mark.
func TestModLogPage(t *testing.T) {
	s := newBanScene(t)
	bob := forumtest.User(t, s.db, "bob", at(0))
	other := newSection(t, s.db, "other")
	bobReply := mustReply(t, s.f, s.topic, bob, "bob's reply", at(3))
	s.h.userID = s.mod
	for _, step := range []struct {
		target string
		form   url.Values
	}{
		{modURL(s.topic, topicRename), url.Values{"title": {"renamed"}, "reason": {"clearer"}}},
		{modURL(s.topic, topicMove), url.Values{"section": {fmt.Sprint(other)}}},
		{deleteURL(bobReply), url.Values{"reason": {"rude"}}},
		{sectionEditURL(s.section), url.Values{"name": {"section 2"}}},
		{sectionMoveURL(other), url.Values{"direction": {"up"}}},
		{deleteURL(s.reply), url.Values{"ban": {"1"}, "duration": {"30"}, "reason": {"spam"}}},
		{liftURL(1), url.Values{}},
		{modURL(s.topic, topicDelete), url.Values{}},
	} {
		redirectedTo(t, s.h.post(t, s.f, step.target, step.form))
	}
	log := modLog(t, s.db)
	// The delete window with a ban writes two lines.
	assert.Equal(t, len(log), 9)

	s.h.get(t, s.f, modLogURL)
	assert.Equal(t, s.h.status, http.StatusOK)
	assert.Equal(t, s.h.page.NoIndex, true)
	body := string(s.h.page.Body)
	assert.Equal(t, strings.Count(body, `<li class="forum-row" id="log-`), 9)
	// The newest first.
	assert.Equal(t, strings.Index(body, `id="log-9"`) < strings.Index(body, `id="log-1"`), true)
	for _, link := range []string{
		fmt.Sprintf(`href="/forum/topic/%d">renamed</a> <span class="forum-label deleted">`, s.topic),
		fmt.Sprintf(`href="/forum/post/%d"`, bobReply),
		fmt.Sprintf(`href="/forum/post/%d"`, s.reply),
		fmt.Sprintf(`href="/forum/section/%d">section 2</a>`, s.section),
		fmt.Sprintf(`href="/forum/section/%d">other</a>`, other),
	} {
		assert.StringContains(t, body, link)
	}
	// What the targets no longer show, and the reasons, as the moderators typed them.
	// A target reads by its name of now: the section left by the topic was renamed after.
	last := len(sectionIDs(t, s.f))
	for _, text := range []string{
		": title</span>", "section 2 → other", ": section</span>", fmt.Sprintf(": %d → %d", last, last-1),
		": clearer</span>", ": rude</span>", ": spam</span>",
	} {
		assert.StringContains(t, body, text)
	}
	assert.Equal(t, len(s.h.logged), 0)
}

// The log goes by pages of logEntriesPerPage; a page past the last is not found.
func TestModLogPages(t *testing.T) {
	s := newBanScene(t)
	_, err := s.db.Exec(context.Background(), `
		INSERT INTO forum_mod_log (moderator_id, action, topic_id)
		SELECT $1, 'topic.pin', $2 FROM generate_series(1, $3)`, s.mod, s.topic, logEntriesPerPage+1)
	assert.NilError(t, err)
	s.h.userID = s.mod

	s.h.get(t, s.f, modLogURL)
	body := string(s.h.page.Body)
	assert.Equal(t, strings.Count(body, `id="log-`), logEntriesPerPage)
	assert.StringContains(t, body, `href="`+modLogURL+`?page=2"`)
	s.h.get(t, s.f, modLogURL+"?page=2")
	assert.Equal(t, strings.Count(string(s.h.page.Body), `id="log-`), 1)
	assert.StringContains(t, string(s.h.page.Body), `id="log-1"`)
	for _, page := range []string{"3", "0", "x"} {
		s.h.get(t, s.f, modLogURL+"?page="+page)
		assert.Equal(t, s.h.notFound, true)
	}
}

// Only moderators read the log and the bans: a guest goes to sign in, a member and a banned user
// get 403.
func TestModLogAndBansRefused(t *testing.T) {
	s := newBanScene(t)
	bob := forumtest.User(t, s.db, "bob", at(0))
	insertBan(t, s.db, s.alice, s.mod)
	for _, target := range []string{modLogURL, bansURL} {
		s.h.userID = 0
		assert.Equal(t, redirectedTo(t, s.h.get(t, s.f, target)), "/user/login")
		for _, viewer := range []int{bob, s.alice} {
			s.h.userID = viewer
			assert.Equal(t, s.h.get(t, s.f, target).Code, http.StatusForbidden)
			assert.Equal(t, s.h.status, 0)
		}
	}
}
