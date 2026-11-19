package forum

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// inlineText is the text of the inline nodes under n, words joined by single spaces.
func inlineText(n ast.Node, src []byte) string {
	var b strings.Builder
	ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			if c.Type() == ast.TypeBlock {
				b.WriteByte(' ')
			}
			return ast.WalkContinue, nil
		}
		switch c := c.(type) {
		case *ast.Text:
			b.Write(util.UnescapePunctuations(c.Segment.Value(src)))
			if c.SoftLineBreak() || c.HardLineBreak() {
				b.WriteByte(' ')
			}
		case *ast.String:
			b.Write(c.Value)
		case *ast.FencedCodeBlock, *ast.CodeBlock:
			b.Write(c.Lines().Value(src))
		}
		return ast.WalkContinue, nil
	})
	return strings.Join(strings.Fields(b.String()), " ")
}

// parsedQuote is a quote as the renderer reads it: its head and what follows the head.
type parsedQuote struct {
	src         []byte
	quote       *ast.Blockquote
	head        *quoteHeadNode
	name, link  string
	nestedQuote bool
}

func parseQuote(t *testing.T, s string) parsedQuote {
	t.Helper()
	q := parsedQuote{src: []byte(s)}
	doc := markdown.Parser().Parse(text.NewReader(q.src))
	if doc.ChildCount() != 1 {
		t.Fatalf("%d blocks, want the quote alone:\n%s", doc.ChildCount(), s)
	}
	var ok bool
	if q.quote, ok = doc.FirstChild().(*ast.Blockquote); !ok {
		t.Fatalf("not a quote:\n%s", s)
	}
	if q.head, ok = q.quote.FirstChild().(*quoteHeadNode); !ok {
		t.Fatalf("the quote has no head:\n%s", s)
	}
	ast.Walk(q.head, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		switch n := n.(type) {
		case *ast.Emphasis:
			if entering && n.Level == 2 {
				q.name = inlineText(n, q.src)
			}
		case *ast.Link:
			q.link = string(n.Destination)
		}
		return ast.WalkContinue, nil
	})
	ast.Walk(q.quote, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if _, ok := n.(*ast.Blockquote); ok && entering && n != q.quote {
			q.nestedQuote = true
		}
		return ast.WalkContinue, nil
	})
	return q
}

// body is the quoted text under the head.
func (q parsedQuote) body() string {
	var parts []string
	for c := q.head.NextSibling(); c != nil; c = c.NextSibling() {
		parts = append(parts, inlineText(c, q.src))
	}
	return strings.Join(parts, " ")
}

// TestQuoteText checks the quote put into the reply form by its structure: the head with the
// author and the link to the post (_prd/forum/plan.md, «Markdown»), one level of quote, the text of
// the post under it. The words of the head are the catalog's and are not compared.
func TestQuoteText(t *testing.T) {
	tests := []struct {
		name, body string
		want       string // the quoted text as words, Markdown left out
	}{
		{"one line", "hello", "hello"},
		{"lines and paragraphs", "one\ntwo\n\nthree", "one two three"},
		{"a quote inside", "> **bob** [wrote in #1](/forum/post/1):\n>\n> old words\n\nmy reply", "my reply"},
		{"a quote inside without the blank line", "> earlier\nlazy line\n\nmine", "mine"},
		{"a quote in the middle", "before\n\n> quoted\n> more\n\nafter", "before after"},
		{"only a quote", "> quoted", ""},
		{"blank lines left by a quote", "a\n\n> q\n\n\n\nb", "a b"},
		{"spoiler", "a ||secret|| b", "a secret b"},
		{"code with > inside", "```\n> not a quote\n```", "> not a quote"},
		{"indented code", "    > code\n\ntext", "> code text"},
		{"list", "- one\n- two", "one two"},
		{"windows line breaks", "one\r\ntwo\r\n\r\n> q\r\n\r\nthree", "one two three"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := post{ID: 123, Number: 12, AuthorName: "alice", Body: tt.body}
			for _, lang := range []string{"en", "ru"} {
				s := quoteText(lang, p)
				q := parseQuote(t, s)
				assert.Equal(t, q.name, "alice")
				assert.Equal(t, q.link, "/forum/post/123")
				assert.Equal(t, q.nestedQuote, false)
				assert.Equal(t, q.body(), tt.want)
				// The reply starts on a line of its own after the quote.
				assert.Equal(t, strings.HasSuffix(s, "\n\n"), true)
			}
		})
	}

	t.Run("code and spoiler stay what they are", func(t *testing.T) {
		q := parseQuote(t, quoteText("en", post{ID: 1, Number: 1, AuthorName: "a",
			Body: "x ||hidden|| y\n\n```go\n> line\n```\n\n    indented"}))
		var spoilers, fenced, indented int
		ast.Walk(q.quote, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
			if !entering {
				return ast.WalkContinue, nil
			}
			switch n := n.(type) {
			case *spoilerNode:
				spoilers++
			case *ast.FencedCodeBlock:
				fenced++
				assert.Equal(t, string(n.Lines().Value(q.src)), "> line\n")
			case *ast.CodeBlock:
				indented++
			}
			return ast.WalkContinue, nil
		})
		assert.Equal(t, spoilers, 1)
		assert.Equal(t, fenced, 1)
		assert.Equal(t, indented, 1)
	})

	t.Run("a name that looks like Markdown", func(t *testing.T) {
		for _, name := range []string{"*Bob*", "under_score_", "[x](/y)", `back\slash`, "a**b", "||s||", "#1 > all"} {
			q := parseQuote(t, quoteText("en", post{ID: 5, Number: 2, AuthorName: name, Body: "text"}))
			assert.Equal(t, q.name, name)
			assert.Equal(t, q.link, "/forum/post/5")
		}
	})
}

func TestQuoteHeadRender(t *testing.T) {
	tests := []struct {
		name, src string
		head      bool
	}{
		{"the head of a quote", "> **a** [wrote](/forum/post/1):\n>\n> text", true},
		{"the head without a blank line", "> **a** [wrote](/forum/post/1):\n> text", true},
		{"the head alone", "> **a** [wrote](/forum/post/1):", true},
		{"a head typed by hand", "> [Bob wrote](/forum/post/77):\n> text", true},
		{"a quote without a link", "> **a** wrote:\n> text", false},
		{"a link to another page", "> **a** [wrote](/forum/topic/1):\n> text", false},
		{"a link to another site", "> **a** [wrote](https://example.com/forum/post/1):", false},
		{"no colon", "> **a** [wrote](/forum/post/1)\n> text", false},
		{"the link on a later line", "> text\n> [wrote](/forum/post/1):", false},
		{"not a quote", "**a** [wrote](/forum/post/1):", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			html, err := renderMarkdown(tt.src)
			assert.NilError(t, err)
			assert.Equal(t, strings.Contains(string(html), `<span class="quote-head">`), tt.head)
			if tt.head {
				// The head is a line of its own: no break inside it, no empty paragraph after it.
				head, _, _ := strings.Cut(strings.SplitN(string(html), `<span class="quote-head">`, 2)[1], "</span>")
				assert.Equal(t, strings.Contains(head, "<br>"), false)
				assert.Equal(t, strings.Contains(string(html), "<p></p>"), false)
			}
		})
	}
	// A quote inside a quote gets its own head.
	html, err := renderMarkdown("> **a** [w](/forum/post/1):\n>\n> > **b** [w](/forum/post/2):\n> >\n> > old\n>\n> new")
	assert.NilError(t, err)
	assert.Equal(t, strings.Count(string(html), `<span class="quote-head">`), 2)
}

// TestQuotePost: Quote opens the last page of the topic, where the reply form is, with the quote of
// the post in the form; a post or topic the viewer may not quote is refused.
func TestQuotePost(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	bob := forumtest.User(t, db, "bob", at(0))
	mod := newModerator(t, db, "mod")
	topicID, posts := posts45(t, f, db)
	quoteURL := func(id int) string { return postURL(id) + "/quote" }

	// A post of the first page: the form is on the third.
	h.userID = bob
	h.get(t, f, quoteURL(posts[1]))
	assert.Equal(t, h.status, http.StatusOK)
	assert.Equal(t, h.page.NoIndex, true)
	assert.Equal(t, h.page.Canonical, fmt.Sprintf("https://example.com/forum/topic/%d?page=3", topicID))
	page := string(h.page.Body)
	assert.StringContains(t, page, `id="forum-reply-body"`)
	assert.StringContains(t, page, fmt.Sprintf("](%s):", postURL(posts[1])))
	// The link under a post is where the form is, without a script.
	assert.StringContains(t, page, fmt.Sprintf(`href="%s#reply"`, quoteURL(posts[44])))

	section := newSection(t, db, "other")
	closed, _ := mustCreateTopic(t, f, section, bob, "closed", at(0))
	inClosed := mustReply(t, f, closed, bob, "in a closed topic", at(1))
	closeTopic(t, db, closed)
	gone, _ := mustCreateTopic(t, f, section, bob, "gone", at(0))
	inGone := mustReply(t, f, gone, bob, "in a deleted topic", at(1))
	deleteTopic(t, db, gone)
	deletePost(t, db, posts[2])

	tests := []struct {
		name   string
		viewer int
		post   int
		want   int // 200, 303 to sign in, 403, or 404 for the site's not found
	}{
		{"guest", 0, posts[1], http.StatusSeeOther},
		{"member, a deleted post", bob, posts[2], http.StatusForbidden},
		{"moderator, a deleted post", mod, posts[2], http.StatusForbidden},
		{"member, a closed topic", bob, inClosed, http.StatusForbidden},
		{"moderator, a closed topic", mod, inClosed, http.StatusOK},
		{"member, a deleted topic", bob, inGone, http.StatusNotFound},
		{"moderator, a deleted topic", mod, inGone, http.StatusForbidden},
		{"member, no post", bob, 999999, http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h.userID = tt.viewer
			rec := h.get(t, f, quoteURL(tt.post))
			switch tt.want {
			case http.StatusOK:
				assert.Equal(t, h.status, http.StatusOK)
			case http.StatusNotFound:
				assert.Equal(t, h.notFound, true)
			default:
				assert.Equal(t, rec.Code, tt.want)
				assert.Equal(t, h.status, 0)
			}
		})
	}
}
