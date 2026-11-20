package forum

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"charactersheet.iociveteres.net/internal/util"
)

func TestNewAvatar(t *testing.T) {
	assert.Equal(t, newAvatar("/avatar/a", "alice", 7, 96), avatar{URL: "/avatar/a", Size: 96})
	// The letter on the user's tint, the same as on the Account page.
	assert.Equal(t, newAvatar("", "alice", 7, 96), avatar{Initial: "A", Hue: util.AvatarHue(7), Size: 96})
	assert.Equal(t, newAvatar("", " ёлка", 8, 40), avatar{Initial: "Ё", Hue: util.AvatarHue(8), Size: 40})
	assert.Equal(t, newAvatar("", "", 9, 96), avatar{Hue: util.AvatarHue(9), Size: 96})
}

func TestTopicPageAvatars(t *testing.T) {
	db := forumtest.NewDB(t)
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	carol := forumtest.User(t, db, "carol", at(0))
	reader := forumtest.User(t, db, "reader", at(0))
	host := &testHost{avatarURLs: map[int]string{
		alice:  "/avatar/aaaaaaaaaaaaaaaa",
		bob:    "/avatar/bbbbbbbbbbbbbbbb",
		reader: "/avatar/rrrrrrrrrrrrrrrr",
	}}
	f := newTestForum(t, db, host)
	// 25 posts by three authors in turn: two pages, the first of 20.
	authors := []int{alice, bob, carol}
	topicID, first := mustCreateTopic(t, f, newSection(t, db, "section"), alice, "topic", at(1))
	posts := []int{first}
	for i := 1; i < 25; i++ {
		posts = append(posts, mustReply(t, f, topicID, authors[i%3], fmt.Sprintf("reply %d", i), at(1+i)))
	}
	path := fmt.Sprintf("/forum/topic/%d", topicID)
	load := func(target string) string {
		t.Helper()
		host.avatarCalls, host.avatarIDs, host.logged = 0, nil, nil
		host.get(t, f, target)
		assert.Equal(t, host.found(t, target), true)
		return string(host.page.Body)
	}
	img := func(url string, size int) string {
		return fmt.Sprintf(`<img src="%s" alt="" width="%d" height="%d" loading="lazy">`, url, size, size)
	}
	letterOf := func(id int, initial string) string {
		return fmt.Sprintf(`<span class="forum-avatar letter avatar-hue avatar-hue-%d" aria-hidden="true">%s</span>`,
			util.AvatarHue(id), initial)
	}
	letter := letterOf(carol, "C")

	// One query a page, whatever its number of posts: its authors and the reader, each once.
	host.userID = reader
	for _, page := range []struct {
		query string
		posts int
	}{{"", 20}, {"?page=2", 5}} {
		body := load(path + page.query)
		assert.Equal(t, host.avatarCalls, 1)
		ids := slices.Clone(host.avatarIDs[0])
		slices.Sort(ids)
		assert.Equal(t, slices.Equal(ids, []int{alice, bob, carol, reader}), true)

		third := page.posts / 3
		assert.Equal(t, strings.Count(body, img(host.avatarURLs[alice], avatarSize))+
			strings.Count(body, img(host.avatarURLs[bob], avatarSize))+strings.Count(body, letter), page.posts)
		assert.Equal(t, strings.Count(body, letter) >= third, true)
		// The reply form under the last page shows the reader's own, small.
		form := 0
		if page.query != "" {
			form = 1
		}
		assert.Equal(t, strings.Count(body, img(host.avatarURLs[reader], replyAvatarSize)), form)
	}

	// A guest is not asked about.
	host.userID = 0
	load(path)
	assert.Equal(t, host.avatarCalls, 1)
	assert.Equal(t, slices.Contains(host.avatarIDs[0], 0), false)

	// The avatars failing, the page is served with letters and the error logged.
	host.avatarErr = errors.New("avatars down")
	host.userID = reader
	body := load(path + "?page=2")
	assert.Equal(t, host.status, 200)
	assert.Equal(t, strings.Contains(body, "<img"), false)
	assert.Equal(t, strings.Contains(body, letterOf(alice, "A")), true)
	assert.Equal(t, strings.Contains(body, letterOf(reader, "R")), true)
	assert.Equal(t, len(host.logged), 1)
	assert.Equal(t, errors.Is(host.logged[0], host.avatarErr), true)
	host.avatarErr = nil

	// The page that deletes a post shows it with its author's avatar, asked for alone.
	host.userID = alice
	body = load(fmt.Sprintf("/forum/post/%d/delete", posts[3]))
	assert.Equal(t, host.avatarCalls, 1)
	assert.Equal(t, slices.Equal(host.avatarIDs[0], []int{alice}), true)
	assert.Equal(t, strings.Count(body, img(host.avatarURLs[alice], avatarSize)), 1)

	// The edit form shows the editor's own, as the reply form; a letter for one without.
	body = load(fmt.Sprintf("/forum/post/%d/edit", posts[3]))
	assert.Equal(t, host.avatarCalls, 1)
	assert.Equal(t, strings.Count(body, img(host.avatarURLs[alice], replyAvatarSize)), 1)
	host.userID = carol
	body = load(fmt.Sprintf("/forum/post/%d/edit", posts[2]))
	assert.Equal(t, strings.Count(body, letterOf(carol, "C")), 1)
}
