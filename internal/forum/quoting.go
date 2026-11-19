package forum

import (
	"net/http"
	"strings"

	"charactersheet.iociveteres.net/internal/i18n"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

// quotePost is the Quote link under a post: the last page of its topic, where the reply form is,
// with the quote in the form. A guest goes to sign in and back; a deleted post, or a topic where the
// viewer may not reply, gets 403; a post the viewer cannot read is not found.
func (f *Forum) quotePost(w http.ResponseWriter, r *http.Request, v view) {
	p, ok := f.postToActOn(w, r, v, Viewer.CanQuote)
	if !ok {
		return
	}
	f.renderTopic(w, r, v, p.Topic, pageCount(p.Topic.PostCount, postsPerPage),
		postForm{Body: quoteText(v.Lang, p.post)}, http.StatusOK, true)
}

// quoteText is what Quote puts into the reply form, in the language of the one who quotes, and the
// post keeps it so (_prd/forum/plan.md, «Markdown», «Строки»):
//
//	> **Name** [wrote in #12](/forum/post/123):
//	>
//	> the text of the post, its own quotes left out
//
// followed by an empty line for the reply. The head is how the renderer (quoteHeadTransformer) and
// block 6 know a quote of a post; the blank quote line keeps an indented code block of the post a
// code block.
func quoteText(lang string, p post) string {
	var b strings.Builder
	b.WriteString(quoteHead(lang, p))
	b.WriteString("\n")
	if body := withoutQuotes(p.Body); body != "" {
		b.WriteString(">\n")
		for _, line := range strings.Split(body, "\n") {
			if line == "" {
				b.WriteString(">\n")
			} else {
				b.WriteString("> " + line + "\n")
			}
		}
	}
	b.WriteString("\n")
	return b.String()
}

// quoteHead is the first line of a quote of p: > **Name** [wrote in #12](/forum/post/123):
func quoteHead(lang string, p post) string {
	var b strings.Builder
	b.WriteString("> **")
	b.WriteString(escapeMarkdown(p.AuthorName))
	b.WriteString("** [")
	// The name of the author can be anything; the words of the catalog only need their brackets
	// kept from closing the link.
	b.WriteString(strings.NewReplacer(`\`, `\\`, `[`, `\[`, `]`, `\]`).
		Replace(i18n.T(lang, "forum.posts.quoteWrote", i18n.Params{"n": p.Number})))
	b.WriteString("](")
	b.WriteString(p.URL())
	b.WriteString("):")
	return b.String()
}

// QuoteHead is the head of a quote of the card's post for the forum script, which quotes the
// selected part of a post into the reply form on the page (ui/static/js/forum/quote.ts); empty
// where Quote is not offered.
func (c postCard) QuoteHead() string {
	if !c.Actions || !c.Viewer.CanQuote(c.Topic, c.Post) {
		return ""
	}
	return quoteHead(c.Lang, c.Post)
}

// escapeMarkdown puts a backslash before every ASCII punctuation character, which CommonMark then
// reads as the character itself: a name like "*Bob*" stays a name.
func escapeMarkdown(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r < 128 && strings.ContainsRune("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", r) {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// withoutQuotes is the text of a post without its quotes, so that a quote of it holds one level
// (task 3.2). The parser tells which lines are a quote's: a lazy line continuing a quoted paragraph
// goes too, a line with > in a code block outside the quotes stays. Lines no block owns (fences, a
// lone >, blank lines) go when they open with >. Runs of blank lines left behind become one.
func withoutQuotes(body string) string {
	src := []byte(strings.ReplaceAll(body, "\r\n", "\n"))
	starts := []int{0}
	for i, c := range src {
		if c == '\n' {
			starts = append(starts, i+1)
		}
	}
	lineOf := func(offset int) int {
		lo, hi := 0, len(starts)-1
		for lo < hi {
			mid := (lo + hi + 1) / 2
			if starts[mid] <= offset {
				lo = mid
			} else {
				hi = mid - 1
			}
		}
		return lo
	}
	const (
		free = iota
		kept
		quoted
	)
	owner := make([]int, len(starts))
	depth := 0
	ast.Walk(markdown.Parser().Parse(text.NewReader(src)), func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if _, ok := n.(*ast.Blockquote); ok {
			if entering {
				depth++
			} else {
				depth--
			}
			return ast.WalkContinue, nil
		}
		if !entering || n.Type() != ast.TypeBlock {
			return ast.WalkContinue, nil
		}
		lines := n.Lines()
		for i := 0; i < lines.Len(); i++ {
			l := lineOf(lines.At(i).Start)
			if depth > 0 {
				owner[l] = quoted
			} else if owner[l] == free {
				owner[l] = kept
			}
		}
		return ast.WalkContinue, nil
	})

	lines := strings.Split(string(src), "\n")
	var out []string
	for i, line := range lines {
		switch owner[i] {
		case quoted:
			continue
		case free:
			if trimmed := strings.TrimLeft(line, " "); len(line)-len(trimmed) < 4 && strings.HasPrefix(trimmed, ">") {
				continue
			}
		}
		if owner[i] == free && strings.TrimSpace(line) == "" {
			if len(out) == 0 || out[len(out)-1] == "" {
				continue
			}
			line = ""
		}
		out = append(out, line)
	}
	return strings.TrimRight(strings.Join(out, "\n"), "\n")
}
