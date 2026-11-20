package forum

import (
	"bytes"
	stdhtml "html"
	"html/template"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// The Markdown of posts (_prd/forum/plan.md, «Markdown»): CommonMark with hard wraps, bare
// addresses as links, pictures under a spoiler (images.go), a ||spoiler||, no raw HTML, tables or
// footnotes.
var markdown = goldmark.New(
	goldmark.WithParser(parser.NewParser(
		// Without the HTML parsers typed HTML stays text and is escaped like any other: <b> reads
		// as <b>, instead of vanishing as goldmark's "raw HTML omitted" would make it.
		parser.WithBlockParsers(without(parser.DefaultBlockParsers(), parser.NewHTMLBlockParser())...),
		parser.WithInlineParsers(without(parser.DefaultInlineParsers(), parser.NewRawHTMLParser())...),
		parser.WithParagraphTransformers(parser.DefaultParagraphTransformers()...),
	)),
	goldmark.WithExtensions(
		extension.NewLinkify(extension.WithLinkifyAllowedProtocols([]string{"http:", "https:", "mailto:"})),
		spoilerExtension{},
		linkExtension{},
		quoteHeadExtension{},
		imageExtension{},
	),
	goldmark.WithRendererOptions(html.WithHardWraps()),
)

func without(parsers []util.PrioritizedValue, drop any) []util.PrioritizedValue {
	kept := parsers[:0]
	for _, p := range parsers {
		if p.Value != drop {
			kept = append(kept, p)
		}
	}
	return kept
}

// renderMarkdown is a post as its reader sees it; templates call it as {{$.Markdown .Body}}. Posts
// store Markdown, not HTML, so a fix of the renderer reaches old posts too.
func renderMarkdown(src string, options renderOptions) (template.HTML, error) {
	var buf bytes.Buffer
	pc := parser.NewContext()
	pc.Set(renderOptionsKey, options)
	if err := markdown.Convert([]byte(src), &buf, parser.WithContext(pc)); err != nil {
		return "", err
	}
	return template.HTML(buf.String()), nil
}

// linkRel goes on every link to another site: guests and search engines read the forum.
const linkRel = "nofollow ugc noopener"

// href is the address as the browser will read it, and whether it may be a link: http, https,
// mailto or no scheme. It checks the address after goldmark resolves its entities, so
// &#106;avascript: is caught too. A list of what is allowed, not of what is not: goldmark's own
// check lets data:image through.
func href(dest []byte, resolveEntities bool) ([]byte, bool) {
	escaped := util.URLEscape(dest, resolveEntities)
	u, err := url.Parse(string(escaped))
	if err != nil {
		return nil, false
	}
	switch strings.ToLower(u.Scheme) {
	case "", "http", "https", "mailto":
		return escaped, true
	}
	return nil, false
}

// linkExtension renders links, bare addresses and the pictures that are no block (images.go): such
// a picture is a link with its caption marked 🖼, an unsafe address stays text.
type linkExtension struct{}

func (linkExtension) Extend(m goldmark.Markdown) {
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(linkRenderer{}, 100)))
}

type linkRenderer struct{}

func (linkRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindLink, func(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
		n := node.(*ast.Link)
		return renderLink(w, n.Destination, n.Title, entering)
	})
	reg.Register(ast.KindImage, func(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
		n := node.(*ast.Image)
		// Inside a link the caption is a part of its text: a link in a link is no HTML.
		if inLink(n) {
			if entering {
				w.WriteString(`<span class="forum-img-off">`)
			} else {
				w.WriteString("</span>")
			}
			return ast.WalkContinue, nil
		}
		link, ok := href(n.Destination, true)
		if !n.HasChildren() {
			// ![](address) has no caption to click on: the address is the text.
			if entering {
				if ok {
					openLink(w, link, n.Title, "forum-img-off")
					w.Write(util.EscapeHTML(n.Destination))
					w.WriteString("</a>")
				} else {
					w.Write(util.EscapeHTML(n.Destination))
				}
			}
			return ast.WalkSkipChildren, nil
		}
		if !ok {
			return ast.WalkContinue, nil
		}
		if entering {
			openLink(w, link, n.Title, "forum-img-off")
		} else {
			w.WriteString("</a>")
		}
		return ast.WalkContinue, nil
	})
	reg.Register(ast.KindAutoLink, func(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		n := node.(*ast.AutoLink)
		dest := n.URL(source)
		if n.AutoLinkType == ast.AutoLinkEmail && !bytes.HasPrefix(bytes.ToLower(dest), []byte("mailto:")) {
			dest = append([]byte("mailto:"), dest...)
		}
		label := util.EscapeHTML(n.Label(source))
		link, ok := href(dest, false)
		if !ok {
			w.Write(label)
			return ast.WalkContinue, nil
		}
		openLink(w, link, nil, "")
		w.Write(label)
		w.WriteString("</a>")
		return ast.WalkContinue, nil
	})
}

// renderLink wraps the children in <a>, or leaves them bare when the address is unsafe.
func renderLink(w util.BufWriter, dest, title []byte, entering bool) (ast.WalkStatus, error) {
	link, ok := href(dest, true)
	if !ok {
		return ast.WalkContinue, nil
	}
	if entering {
		openLink(w, link, title, "")
	} else {
		w.WriteString("</a>")
	}
	return ast.WalkContinue, nil
}

func inLink(n ast.Node) bool {
	for p := n.Parent(); p != nil; p = p.Parent() {
		if p.Kind() == ast.KindLink {
			return true
		}
	}
	return false
}

// openLink takes the address from href; class "forum-img-off" is a picture that stays a link,
// which forum.css marks 🖼.
func openLink(w util.BufWriter, link, title []byte, class string) {
	w.WriteString(`<a `)
	if class != "" {
		w.WriteString(`class="` + class + `" `)
	}
	w.WriteString(`href="`)
	w.Write(util.EscapeHTML(link))
	w.WriteByte('"')
	if title != nil {
		w.WriteString(` title="`)
		html.DefaultWriter.Write(w, title)
		w.WriteByte('"')
	}
	// A quote links to /forum/post/{id}: links within the site are not marked.
	if u, err := url.Parse(string(link)); err == nil && (u.Scheme != "" || u.Host != "") {
		w.WriteString(` rel="` + linkRel + `"`)
	}
	w.WriteByte('>')
}

// spoilerExtension parses ||text|| inside a paragraph (plan decision 4) the way GFM parses
// ~~strikethrough~~: a delimiter pair, so it nests with emphasis and stays text inside code or
// without its pair. Unlike ~~, spaces next to the bars do not break it.
type spoilerExtension struct{}

func (spoilerExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithInlineParsers(util.Prioritized(spoilerParser{}, 500)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(spoilerRenderer{}, 500)))
}

var kindSpoiler = ast.NewNodeKind("Spoiler")

type spoilerNode struct{ ast.BaseInline }

func (n *spoilerNode) Kind() ast.NodeKind { return kindSpoiler }

func (n *spoilerNode) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type spoilerDelimiter struct{}

func (spoilerDelimiter) IsDelimiter(b byte) bool { return b == '|' }

func (spoilerDelimiter) CanOpenCloser(opener, closer *parser.Delimiter) bool {
	return opener.Char == closer.Char
}

func (spoilerDelimiter) OnMatch(int) ast.Node { return &spoilerNode{} }

type spoilerParser struct{}

func (spoilerParser) Trigger() []byte { return []byte{'|'} }

func (spoilerParser) Parse(_ ast.Node, block text.Reader, pc parser.Context) ast.Node {
	before := block.PrecendingCharacter()
	line, segment := block.PeekLine()
	node := parser.ScanDelimiter(line, before, 2, spoilerDelimiter{})
	// Exactly two bars: ||| and longer runs stay text.
	if node == nil || node.OriginalLength != 2 || before == '|' {
		return nil
	}
	// Spaces next to the bars are allowed, as in Discord (|| text ||): every pair opens and
	// closes, without the flanking rules of * and ~~. The author accepted that a phrase with two
	// || hides the text between them.
	node.CanOpen, node.CanClose = true, true
	node.Segment = segment.WithStop(segment.Start + node.OriginalLength)
	block.Advance(node.OriginalLength)
	pc.PushDelimiter(node)
	return node
}

func (spoilerParser) CloseBlock(ast.Node, parser.Context) {}

type spoilerRenderer struct{}

func (spoilerRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindSpoiler, func(w util.BufWriter, _ []byte, _ ast.Node, entering bool) (ast.WalkStatus, error) {
		// tabindex: the spoiler opens on focus too, so a keyboard or a tap on a phone opens it
		// without a script.
		if entering {
			w.WriteString(`<span class="spoiler" tabindex="0">`)
		} else {
			w.WriteString("</span>")
		}
		return ast.WalkContinue, nil
	})
}

// quoteHeadExtension sets the head of a quote apart from its text: the first line of a blockquote
// that links to a post and ends with a colon, "> **Name** [wrote in #12](/forum/post/123):"
// (quoteText), becomes span.quote-head over the quoted paragraphs.
type quoteHeadExtension struct{}

func (quoteHeadExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(util.Prioritized(quoteHeadTransformer{}, 500)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(quoteHeadRenderer{}, 500)))
}

var kindQuoteHead = ast.NewNodeKind("QuoteHead")

// quoteHeadNode holds the inline nodes of the head line; it is a block, the first child of its
// blockquote.
type quoteHeadNode struct{ ast.BaseBlock }

func (n *quoteHeadNode) Kind() ast.NodeKind { return kindQuoteHead }

func (n *quoteHeadNode) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

// quotedPostPath is the address a quote head links to; block 6 finds the quoted post by it.
var quotedPostPath = regexp.MustCompile(`^/forum/post/[0-9]+$`)

type quoteHeadTransformer struct{}

func (quoteHeadTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	source := reader.Source()
	var quotes []*ast.Blockquote
	ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if q, ok := n.(*ast.Blockquote); ok && entering {
			quotes = append(quotes, q)
		}
		return ast.WalkContinue, nil
	})
	for _, q := range quotes {
		p, ok := q.FirstChild().(*ast.Paragraph)
		if !ok {
			continue
		}
		// The head is the first line of the paragraph: the quoted text may follow it without a
		// blank line, as typed by hand.
		var line []ast.Node
		for c := p.FirstChild(); c != nil; c = c.NextSibling() {
			line = append(line, c)
			if t, ok := c.(*ast.Text); ok && (t.SoftLineBreak() || t.HardLineBreak()) {
				break
			}
		}
		last, ok := line[len(line)-1].(*ast.Text)
		if !ok || !bytes.HasSuffix(bytes.TrimSpace(last.Segment.Value(source)), []byte(":")) || !linksToPost(line) {
			continue
		}
		head := &quoteHeadNode{}
		for _, c := range line {
			p.RemoveChild(p, c)
			head.AppendChild(head, c)
		}
		last.SetSoftLineBreak(false)
		last.SetHardLineBreak(false)
		q.InsertBefore(q, p, head)
		if !p.HasChildren() {
			q.RemoveChild(q, p)
		}
	}
}

// linksToPost is whether one of the nodes is a link to a post of the forum.
func linksToPost(nodes []ast.Node) bool {
	for _, n := range nodes {
		if l, ok := n.(*ast.Link); ok && quotedPostPath.Match(l.Destination) {
			return true
		}
	}
	return false
}

type quoteHeadRenderer struct{}

func (quoteHeadRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindQuoteHead, func(w util.BufWriter, _ []byte, _ ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			w.WriteString(`<span class="quote-head">`)
		} else {
			w.WriteString("</span>\n")
		}
		return ast.WalkContinue, nil
	})
}

// descriptionLength is the length of a page description that search engines show whole.
const descriptionLength = 160

// plainText is the text of a post without its Markdown for a page description, cut to limit
// characters at a word with an ellipsis. Spoilers and code blocks are left out: the description
// shows in search results and link previews. A picture is "🖼 caption".
func plainText(src string, limit int) string {
	return plainTextOf(src, limit, false)
}

// excerptLength is the line of a post's text on its author's page; CSS cuts it to the width.
const excerptLength = 200

// excerpt is the text of a post as a line of its author's page (extras/users.md): plainText without
// the quotes, which are someone else's words.
func excerpt(src string) string {
	return plainTextOf(src, excerptLength, true)
}

func plainTextOf(src string, limit int, skipQuotes bool) string {
	source := []byte(src)
	var b strings.Builder
	ast.Walk(markdown.Parser().Parse(text.NewReader(source)), func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			if n.Type() == ast.TypeBlock {
				b.WriteByte(' ')
			}
			return ast.WalkContinue, nil
		}
		switch n := n.(type) {
		case *spoilerNode, *ast.CodeBlock, *ast.FencedCodeBlock:
			return ast.WalkSkipChildren, nil
		case *ast.Blockquote:
			if skipQuotes {
				return ast.WalkSkipChildren, nil
			}
		case *ast.Text:
			b.Write(n.Segment.Value(source))
			if n.SoftLineBreak() || n.HardLineBreak() {
				b.WriteByte(' ')
			}
		case *ast.String:
			b.Write(n.Value)
		case *ast.AutoLink:
			b.Write(n.Label(source))
		case *ast.Image:
			b.WriteString(" 🖼 ")
		}
		return ast.WalkContinue, nil
	})
	words := strings.Fields(stdhtml.UnescapeString(b.String()))
	s := strings.Join(words, " ")
	if utf8.RuneCountInString(s) <= limit {
		return s
	}
	cut := []rune(s)[:limit]
	if i := strings.LastIndexByte(string(cut), ' '); i > 0 {
		return string(cut)[:i] + "…"
	}
	return string(cut) + "…"
}
