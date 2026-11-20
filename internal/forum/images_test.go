package forum

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
)

// Pictures under a spoiler (extras/images.md, «Что меняется в коде»). The words the renderer adds
// (Picture, Spoiler, N pictures) are not compared: e2e checks texts.
func TestImageBlocks(t *testing.T) {
	const pic = "https://i.example.com/a.png"
	tests := []struct {
		name, src string
		blocks    int      // <details> blocks
		images    int      // pictures inside them
		shape     string   // the whole output as a pattern, when the order matters
		has, not  []string // parts of the output
	}{
		{name: "https picture", src: "![map](" + pic + ")", blocks: 1, images: 1,
			has: []string{
				`<details class="forum-img-spoiler"><summary><span class="cap">🖼 map</span><span class="host">i.example.com</span></summary>`,
				`<a class="forum-img-link" href="` + pic + `" rel="nofollow ugc noopener" target="_blank">`,
				`<img class="forum-img" src="` + pic + `" alt="map" title="map" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>`,
				`<a class="forum-img-broken" href="` + pic + `" rel="nofollow ugc noopener" target="_blank" hidden>`,
			},
			not: []string{"<p>", " open"}},
		{name: "a title of its own", src: `![map](` + pic + ` "Old map")`, blocks: 1, images: 1,
			has: []string{`alt="map" title="Old map"`}},
		{name: "http stays a link", src: "![map](http://i.example.com/a.png)", blocks: 0,
			has: []string{`<a class="forum-img-off" href="http://i.example.com/a.png"`}},
		{name: "data is no picture", src: "![map](data:image/png;base64,AAAA)", blocks: 0,
			shape: `^<p>map</p>$`},
		{name: "javascript is no picture", src: "![map](javascript:alert(1))", blocks: 0,
			shape: `^<p>map</p>$`},
		{name: "without a caption", src: "![](" + pic + ")", blocks: 1, images: 1,
			has: []string{`alt=""`, `<span class="host">i.example.com</span>`}, not: []string{"title="}},
		{name: "the caption escaped", src: "![a <b> & *c*](" + pic + ")", blocks: 1, images: 1,
			has: []string{`alt="a &lt;b&gt; &amp; c"`}, not: []string{"<b>", "<em>"}},
		{name: "several in a row are one block", src: "![a](https://x.example/a.png) ![b](https://y.example/b.png)\n![c](https://x.example/c.png)",
			blocks: 1, images: 3,
			has: []string{`: a, b, c</span><span class="host">x.example, y.example</span>`, `<span class="forum-img-row">`}},
		{name: "text between makes two blocks", src: "![a](" + pic + ") and ![b](" + pic + ")", blocks: 2, images: 2,
			shape: `^<details.*</details>\n<p> and </p>\n<details.*</details>$`},
		{name: "in the middle of a paragraph", src: "before ![a](" + pic + ") after", blocks: 1, images: 1,
			shape: `^<p>before </p>\n<details class="forum-img-spoiler">.*</details>\n<p> after</p>$`},
		{name: "on a line of its own", src: "one\n![a](" + pic + ")\ntwo", blocks: 1, images: 1,
			shape: `^<p>one</p>\n<details.*</details>\n<p>two</p>$`},
		{name: "inside a spoiler", src: "a ||hidden ![a](" + pic + ") more|| b", blocks: 1, images: 1,
			shape: `^<p>a <span class="spoiler" tabindex="0">hidden </span></p>\n` +
				`<details class="forum-img-spoiler in-spoiler"><summary><span class="cap">🖼 [^<]*</span></summary>.*</details>\n` +
				`<p><span class="spoiler" tabindex="0"> more</span> b</p>$`},
		{name: "inside emphasis", src: "*one ![a](" + pic + ") two*", blocks: 1, images: 1,
			shape: `^<p><em>one </em></p>\n<details.*</details>\n<p><em> two</em></p>$`},
		{name: "in a quote", src: "> look:\n> ![a](" + pic + ")", blocks: 1, images: 1,
			shape: `^<blockquote>\n<p>look:</p>\n<details.*</details>\n</blockquote>$`},
		{name: "in a list item", src: "- one ![a](" + pic + ")\n- two", blocks: 1, images: 1,
			has: []string{"<li>one \n<details"}},
		{name: "inside a link", src: "[![a](" + pic + ")](https://site.example)", blocks: 0,
			has: []string{`<a href="https://site.example" rel="nofollow ugc noopener"><span class="forum-img-off">a</span></a>`}},
		{name: "a bare address stays a link", src: "see " + pic, blocks: 0,
			has: []string{`<a href="` + pic + `"`}},
		{name: "in code it is text", src: "`![a](" + pic + ")`", blocks: 0},
		{name: "past the limit, links", src: strings.Repeat("![a]("+pic+")\n\n", imageBlockLimit+2), blocks: imageBlockLimit, images: imageBlockLimit,
			has: []string{`<p><a class="forum-img-off" href="` + pic + `"`}},
		{name: "a run counts once toward the limit", src: strings.Repeat("![a]("+pic+") ![b]("+pic+")\n\n", imageBlockLimit), blocks: imageBlockLimit, images: 2 * imageBlockLimit},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			html, err := renderMarkdown(tt.src, renderOptions{Lang: "en"})
			assert.NilError(t, err)
			got := strings.TrimSpace(string(html))
			assert.Equal(t, strings.Count(got, `<details class="forum-img-spoiler`), tt.blocks)
			assert.Equal(t, strings.Count(got, `<img class="forum-img"`), tt.images)
			if tt.shape != "" && !regexp.MustCompile(`(?s)`+tt.shape).MatchString(got) {
				t.Errorf("got %s\nwant the shape %s", got, tt.shape)
			}
			for _, s := range tt.has {
				assert.StringContains(t, got, s)
			}
			for _, s := range tt.not {
				if strings.Contains(got, s) {
					t.Errorf("got %s\nwant no %q", got, s)
				}
			}
		})
	}
}

// "Pictures at once" opens the blocks, but not a picture the author hid in a spoiler.
func TestImageBlocksOpen(t *testing.T) {
	const src = "![a](https://i.example.com/a.png)\n\n||![b](https://i.example.com/b.png)||"
	html, err := renderMarkdown(src, renderOptions{Lang: "en", ImagesOpen: true})
	assert.NilError(t, err)
	assert.StringContains(t, string(html), `<details class="forum-img-spoiler" open>`)
	assert.StringContains(t, string(html), `<details class="forum-img-spoiler in-spoiler">`)
	closed, err := renderMarkdown(src, renderOptions{Lang: "en"})
	assert.NilError(t, err)
	if strings.Contains(string(closed), " open") {
		t.Errorf("got %s, want every block closed", closed)
	}
}

// "Pictures at once" works for a guest as the density does: the choice goes to the cookie, and the
// browser goes back.
func TestSetImages(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)

	rec := h.post(t, f, "/forum/view/images", url.Values{"images": {"open"}, "redirect": {"/forum/topic/3?page=2"}})
	assert.Equal(t, redirectedTo(t, rec), "/forum/topic/3?page=2")
	cookies := rec.Result().Cookies()
	assert.Equal(t, len(cookies), 1)
	c := cookies[0]
	assert.Equal(t, c.Name, imagesCookie)
	assert.Equal(t, c.Value, "open")
	assert.Equal(t, c.Path, "/forum")
	assert.Equal(t, c.SameSite, http.SameSiteLaxMode)
	assert.Equal(t, c.MaxAge, 365*24*60*60)

	// Off is no cookie, and the redirect stays on the forum.
	rec = h.post(t, f, "/forum/view/images", url.Values{"images": {"closed"}, "redirect": {"//evil.example"}})
	assert.Equal(t, redirectedTo(t, rec), "/forum/")
	cookies = rec.Result().Cookies()
	assert.Equal(t, len(cookies), 1)
	assert.Equal(t, cookies[0].Name, imagesCookie)
	if cookies[0].MaxAge >= 0 {
		t.Errorf("MaxAge %d, want the cookie deleted", cookies[0].MaxAge)
	}

	rec = h.post(t, f, "/forum/view/images", url.Values{"images": {"always"}})
	assert.Equal(t, rec.Code, http.StatusBadRequest)
	assert.Equal(t, len(rec.Result().Cookies()), 0)
}

// The cookie opens the blocks of a topic; the menu item of the home shows its state and sends the
// other value. Every forum page lets pictures in from any https host.
func TestImagesCookie(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	topicID, _ := mustCreateTopic(t, f, newSection(t, db, "section"), alice, "topic", at(0))
	mustReply(t, f, topicID, alice, "![map](https://i.example.com/map.png)", at(1))
	topic := fmt.Sprintf("/forum/topic/%d", topicID)

	get := func(target, cookie string) string {
		t.Helper()
		h.err, h.status, h.page = nil, 0, Page{}
		req := httptest.NewRequest(http.MethodGet, target, nil)
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: imagesCookie, Value: cookie})
		}
		f.Handler().ServeHTTP(httptest.NewRecorder(), req)
		if h.err != nil || h.status != http.StatusOK {
			t.Fatalf("GET %s: status %d, %v", target, h.status, h.err)
		}
		assert.Equal(t, h.page.ImagesFromAnyHost, true)
		return string(h.page.Body)
	}

	assert.StringContains(t, get(topic, ""), `<details class="forum-img-spoiler"><summary>`)
	assert.StringContains(t, get(topic, "open"), `<details class="forum-img-spoiler" open><summary>`)
	assert.StringContains(t, get(topic, "yes"), `<details class="forum-img-spoiler"><summary>`)

	assert.StringContains(t, get("/forum/", ""), `name="images" value="open" class="forum-menu-toggle forum-images-toggle" aria-pressed="false"`)
	assert.StringContains(t, get("/forum/", "open"), `name="images" value="closed" class="forum-menu-toggle forum-images-toggle" aria-pressed="true"`)
}
