package forum

import (
	"context"
	"fmt"
	"html"
	"net/http"
	"regexp"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
)

// Every page of the forum has a title and a description; the home page, a section and a topic are
// the pages for search engines, each at its own address; everything else, forms, notifications,
// moderation, keeps out of them, and the addresses that only lead elsewhere draw no page. The test
// goes through the registered GET routes, so a page added without a decision fails it.
func TestEveryPageHead(t *testing.T) {
	s := newBanScene(t)
	mine := mustReply(t, s.f, s.topic, s.mod, "mine", at(3))
	deleted := mustReply(t, s.f, s.topic, s.alice, "deleted", at(4))
	deletePost(t, s.db, deleted)
	section := fmt.Sprintf("/forum/section/%d", s.section)
	topic := fmt.Sprintf("/forum/topic/%d", s.topic)

	indexed := map[string]string{
		"GET /forum/{$}":          "/forum/",
		"GET /forum/section/{id}": section,
		"GET /forum/topic/{id}":   topic,
	}
	redirects := map[string]bool{
		"GET /forum/post/{id}":         true, // to the post's page of the topic
		"GET /forum/topic/{id}/unread": true, // to the first unread post
		"GET /forum/topic/{id}/reply":  true, // to the reply form on the last page
	}
	// The post each address acts on; the rest take the reply of alice, which the moderator may
	// delete, quote and ban for.
	posts := map[string]int{
		"GET /forum/post/{id}/edit":    mine,
		"GET /forum/post/{id}/restore": deleted,
	}

	for _, viewer := range []struct {
		name string
		id   int
	}{{"guest", 0}, {"moderator", s.mod}} {
		s.h.userID = viewer.id
		seen := 0
		for _, pattern := range s.f.patterns {
			if !strings.HasPrefix(pattern, "GET ") {
				continue
			}
			post, ok := posts[pattern]
			if !ok {
				post = s.reply
			}
			_, path := fillPattern(t, pattern, map[string]string{
				"section/{id}":  fmt.Sprint(s.section),
				"topic/{id}":    fmt.Sprint(s.topic),
				"post/{id}":     fmt.Sprint(post),
				"mod/{action}":  string(topicRename),
				"sections/{id}": fmt.Sprint(s.section),
			})
			canonical, isIndexed := indexed[pattern]
			// A guest is only shown what search engines see; the rest sends them to sign in.
			if viewer.id == 0 && !isIndexed && pattern != "GET /forum/post/{id}" {
				continue
			}
			seen++
			rec := s.h.get(t, s.f, path)
			if redirects[pattern] {
				if rec.Code/100 != 3 || s.h.status != 0 {
					t.Errorf("%s GET %s: status %d, page %d, want a redirect", viewer.name, path, rec.Code, s.h.status)
				}
				continue
			}
			p := s.h.page
			if s.h.status != http.StatusOK {
				t.Errorf("%s GET %s: status %d", viewer.name, path, s.h.status)
				continue
			}
			if p.Title == "" || p.Description == "" {
				t.Errorf("%s GET %s: title %q, description %q", viewer.name, path, p.Title, p.Description)
			}
			if isIndexed {
				assert.Equal(t, p.NoIndex, false)
				assert.Equal(t, p.Canonical, "https://example.com"+canonical)
			} else if !p.NoIndex {
				t.Errorf("%s GET %s: indexed", viewer.name, path)
			}
		}
		if viewer.id == 0 {
			assert.Equal(t, seen, len(indexed)+1)
		} else if seen < 15 {
			t.Errorf("only %d pages seen", seen)
		}
	}

	// The quote is a topic page that names the topic page as its address.
	s.h.get(t, s.f, postURL(s.reply)+"/quote")
	assert.Equal(t, s.h.page.NoIndex, true)
	assert.Equal(t, s.h.page.Canonical, "https://example.com"+topic)

	// A section without a description is described as the forum.
	if _, err := s.db.Exec(context.Background(), `UPDATE forum_sections SET description = '' WHERE id = $1`, s.section); err != nil {
		t.Fatal(err)
	}
	s.h.get(t, s.f, section)
	if s.h.page.Description == "" {
		t.Error("a section without a description has an empty one")
	}
}

// A guest who opens the link to a post that someone shared lands on the page of the topic that
// holds it, a page for search engines, at the post.
func TestSharedPostLinkForGuest(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	topicID, posts := posts45(t, f, db)
	id := posts[24]
	page := fmt.Sprintf("/forum/topic/%d?page=2", topicID)

	// The number of the post is the link to share.
	h.get(t, f, page)
	assert.StringContains(t, string(h.page.Body), fmt.Sprintf(`<a class="num" href="/forum/post/%d"`, id))

	rec := h.get(t, f, fmt.Sprintf("/forum/post/%d", id))
	assert.Equal(t, rec.Code, http.StatusFound)
	location := rec.Header().Get("Location")
	assert.Equal(t, location, fmt.Sprintf("%s#post-%d", page, id))

	target, _, _ := strings.Cut(location, "#")
	h.get(t, f, target)
	assert.Equal(t, h.status, http.StatusOK)
	assert.Equal(t, h.page.NoIndex, false)
	assert.Equal(t, h.page.Canonical, "https://example.com"+page)
	assert.StringContains(t, string(h.page.Body), fmt.Sprintf(`id="post-%d"`, id))
}

var quoteHeadAttr = regexp.MustCompile(`<article class="forum-post[^"]*" id="post-(\d+)" data-quote-head="([^"]*)">`)

// The forum script quotes a selection under the head the server puts on each post the viewer may
// quote: the head of the server's own quote, in the viewer's language.
func TestQuoteHeadForScript(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "a*lice", at(0))
	topicID, first := mustCreateTopic(t, f, newSection(t, db, "section"), alice, "topic", at(1))
	reply := mustReply(t, f, topicID, alice, "reply", at(2))
	gone := mustReply(t, f, topicID, alice, "gone", at(3))
	deletePost(t, db, gone)
	topic := fmt.Sprintf("/forum/topic/%d", topicID)

	// A guest quotes nothing.
	h.get(t, f, topic)
	assert.Equal(t, strings.Contains(string(h.page.Body), "data-quote-head"), false)

	h.userID = alice
	h.get(t, f, topic)
	heads := map[string]string{}
	for _, m := range quoteHeadAttr.FindAllStringSubmatch(string(h.page.Body), -1) {
		heads[m[1]] = html.UnescapeString(m[2])
	}
	// The deleted post offers no Quote.
	assert.Equal(t, len(heads), 2)
	for _, id := range []int{first, reply} {
		p, err := f.loadPost(context.Background(), id, Viewer{})
		assert.NilError(t, err)
		head, _, _ := strings.Cut(quoteText("en", p.post), "\n")
		assert.Equal(t, heads[fmt.Sprint(id)], head)
	}
}
