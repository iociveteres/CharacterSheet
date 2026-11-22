package forum

import (
	"bufio"
	"bytes"
	stdhtml "html"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"charactersheet.iociveteres.net/internal/i18n"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Pictures in posts (_prd/forum/extras/images.md): ![caption](https://…) is a closed <details>
// whose line names the caption and the host; the <img> inside is lazy, so the browser asks the
// host for it only once the reader opens the block. A run of pictures with only spaces between
// them is one block. A picture that cannot be a block stays a link marked 🖼: http (a https page
// does not show it), inside a link, past the limit of blocks.

// imageBlockLimit is how many blocks a post shows; the pictures after them are links
// (extras/decisions.md, 23).
const imageBlockLimit = 10

// renderOptions are what the reader changes in a rendered post: the language of the words the
// renderer adds and the menu item "Pictures at once".
type renderOptions struct {
	Lang       string
	ImagesOpen bool
}

var renderOptionsKey = parser.NewContextKey()

type imageExtension struct{}

func (imageExtension) Extend(m goldmark.Markdown) {
	// After quoteHeadTransformer (500): a picture on the head line stays there, a link.
	m.Parser().AddOptions(parser.WithASTTransformers(util.Prioritized(imageBlockTransformer{}, 600)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(imageBlockRenderer{}, 500)))
}

var kindImageBlock = ast.NewNodeKind("ImageBlock")

// imageBlock holds the *ast.Image nodes of one block.
type imageBlock struct {
	ast.BaseBlock
	// spoiler: the pictures were inside a ||spoiler||, so the line says only that.
	spoiler bool
	options renderOptions
}

func (n *imageBlock) Kind() ast.NodeKind { return kindImageBlock }

func (n *imageBlock) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

// blockImageURL is the address of a picture that may be a block: https with a host, after href's
// check.
func blockImageURL(img *ast.Image) ([]byte, *url.URL, bool) {
	link, ok := href(img.Destination, true)
	if !ok {
		return nil, nil, false
	}
	u, err := url.Parse(string(link))
	if err != nil || !strings.EqualFold(u.Scheme, "https") || u.Hostname() == "" {
		return nil, nil, false
	}
	return link, u, true
}

type imageBlockTransformer struct{}

// Transform takes each run of pictures out of its paragraph: a <details> cannot stand inside a
// <p>, so the paragraph splits into the text before, the block and the text after; emphasis and
// spoilers around the run split with it.
func (imageBlockTransformer) Transform(doc *ast.Document, reader text.Reader, pc parser.Context) {
	options, _ := pc.Get(renderOptionsKey).(renderOptions)
	source := reader.Source()
	var paragraphs []ast.Node
	ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering && (n.Kind() == ast.KindParagraph || n.Kind() == ast.KindTextBlock) {
			paragraphs = append(paragraphs, n)
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	blocks := 0
	for _, p := range paragraphs {
		for p != nil && blocks < imageBlockLimit {
			run := firstRun(p, source)
			if run == nil {
				break
			}
			p = hoist(p, run, options, source)
			blocks++
		}
	}
}

// firstRun is the first run of block pictures in the paragraph, siblings with only whitespace
// between them; nil when there is none. Pictures inside a link (or a caption) stay where they are.
func firstRun(p ast.Node, source []byte) []*ast.Image {
	var run []*ast.Image
	ast.Walk(p, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering || n == p {
			return ast.WalkContinue, nil
		}
		switch n := n.(type) {
		case *ast.Image:
			if _, _, ok := blockImageURL(n); ok {
				run = runFrom(n, source)
				return ast.WalkStop, nil
			}
			return ast.WalkSkipChildren, nil
		case *ast.Emphasis, *spoilerNode:
			return ast.WalkContinue, nil
		}
		// Only emphasis and spoilers split around a block; a link keeps its pictures.
		return ast.WalkSkipChildren, nil
	})
	return run
}

func runFrom(first *ast.Image, source []byte) []*ast.Image {
	run := []*ast.Image{first}
	for n := first.NextSibling(); n != nil; n = n.NextSibling() {
		if img, ok := n.(*ast.Image); ok {
			if _, _, ok := blockImageURL(img); !ok {
				break
			}
			run = append(run, img)
			continue
		}
		if !blank(n, source) {
			break
		}
	}
	return run
}

// blank is whether the node shows nothing but whitespace.
func blank(n ast.Node, source []byte) bool {
	switch n := n.(type) {
	case *ast.Text:
		return len(bytes.TrimSpace(n.Segment.Value(source))) == 0
	case *ast.String:
		return len(bytes.TrimSpace(n.Value)) == 0
	case *ast.Emphasis, *spoilerNode:
		for c := n.FirstChild(); c != nil; c = c.NextSibling() {
			if !blank(c, source) {
				return false
			}
		}
		return true
	}
	return false
}

// shell is an empty node like n, to hold the part of n before or after a block.
func shell(n ast.Node) ast.Node {
	switch n := n.(type) {
	case *ast.Emphasis:
		return ast.NewEmphasis(n.Level)
	case *spoilerNode:
		return &spoilerNode{}
	case *ast.TextBlock:
		return ast.NewTextBlock()
	}
	return ast.NewParagraph()
}

// hoist puts the run's block in place of the paragraph p, between the parts of p before and after
// it, and returns the part after (nil when it is blank) for the next run.
func hoist(p ast.Node, run []*ast.Image, options renderOptions, source []byte) ast.Node {
	parent := run[0].Parent()
	chain := []ast.Node{parent}
	for n := parent; n != p; {
		n = n.Parent()
		chain = append([]ast.Node{n}, chain...)
	}
	block := &imageBlock{options: options}
	before, after := shell(p), shell(p)
	b, a := before, after
	for i, n := range chain {
		first, last := ast.Node(run[0]), ast.Node(run[len(run)-1])
		if i+1 < len(chain) {
			first, last = chain[i+1], chain[i+1]
		}
		if _, ok := n.(*spoilerNode); ok {
			block.spoiler = true
		}
		for c := n.FirstChild(); c != first; {
			next := c.NextSibling()
			n.RemoveChild(n, c)
			b.AppendChild(b, c)
			c = next
		}
		var tail []ast.Node
		for c := last.NextSibling(); c != nil; c = c.NextSibling() {
			tail = append(tail, c)
		}
		var nb, na ast.Node
		if i+1 < len(chain) {
			nb, na = shell(chain[i+1]), shell(chain[i+1])
			b.AppendChild(b, nb)
			a.AppendChild(a, na)
		}
		for _, c := range tail {
			n.RemoveChild(n, c)
			a.AppendChild(a, c)
		}
		if nb != nil {
			b, a = nb, na
		}
	}
	for _, img := range run {
		parent.RemoveChild(parent, img)
		block.AppendChild(block, img)
	}

	container := p.Parent()
	if trim(before, source) {
		container.InsertBefore(container, p, before)
	}
	container.InsertBefore(container, p, block)
	keep := trim(after, source)
	if keep {
		container.InsertBefore(container, p, after)
	}
	container.RemoveChild(container, p)
	if !keep {
		return nil
	}
	return after
}

// trim drops the empty shells left in a part of a split paragraph and the line breaks at its
// ends, which would show as blank lines next to the block; false when nothing is left to show.
func trim(part ast.Node, source []byte) bool {
	var prune func(n ast.Node)
	prune = func(n ast.Node) {
		for c := n.FirstChild(); c != nil; {
			next := c.NextSibling()
			switch c.(type) {
			case *ast.Emphasis, *spoilerNode:
				if blank(c, source) {
					n.RemoveChild(n, c)
				} else {
					prune(c)
				}
			}
			c = next
		}
	}
	prune(part)
	if allBlank(part, source) {
		return false
	}
	// Leading blank text: the line break after the block's last picture.
	for n := part.FirstChild(); n != nil && n.Kind() == ast.KindText && blank(n, source); n = part.FirstChild() {
		part.RemoveChild(part, n)
	}
	last := part.LastChild()
	for last != nil && last.HasChildren() {
		last = last.LastChild()
	}
	if t, ok := last.(*ast.Text); ok {
		t.SetSoftLineBreak(false)
		t.SetHardLineBreak(false)
	}
	return true
}

func allBlank(n ast.Node, source []byte) bool {
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		if !blank(c, source) {
			return false
		}
	}
	return true
}

type imageBlockRenderer struct{}

func (imageBlockRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(kindImageBlock, renderImageBlock)
}

func renderImageBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	n := node.(*imageBlock)
	lang := n.options.Lang
	var images []*ast.Image
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		images = append(images, c.(*ast.Image))
	}
	captions := make([][]byte, len(images))
	hosts := []string{}
	for i, img := range images {
		captions[i] = imageCaption(img, source)
		_, u, _ := blockImageURL(img)
		if h := u.Hostname(); !slices.Contains(hosts, h) {
			hosts = append(hosts, h)
		}
	}

	w.WriteString(`<details class="forum-img-spoiler`)
	if n.spoiler {
		w.WriteString(` in-spoiler`)
	}
	w.WriteByte('"')
	// A picture inside a ||spoiler|| waits for a click even with "Pictures at once": the author
	// hid it.
	if n.options.ImagesOpen && !n.spoiler {
		w.WriteString(" open")
	}
	w.WriteString(`><summary><span class="cap">🖼 `)
	switch {
	case n.spoiler:
		w.WriteString(stdhtml.EscapeString(i18n.T(lang, "forum.posts.imageSpoiler")))
	case len(images) == 1 && len(captions[0]) > 0:
		w.Write(captions[0])
	case len(images) == 1:
		w.WriteString(stdhtml.EscapeString(i18n.T(lang, "forum.posts.image")))
	default:
		w.WriteString(stdhtml.EscapeString(i18n.T(lang, "forum.posts.images", i18n.Params{"count": len(images)})))
		sep := ": "
		for _, c := range captions {
			if len(c) > 0 {
				w.WriteString(sep)
				w.Write(c)
				sep = ", "
			}
		}
	}
	w.WriteString(`</span>`)
	// Inside a spoiler the host would tell what is hidden too.
	if !n.spoiler {
		w.WriteString(`<span class="host">`)
		w.WriteString(stdhtml.EscapeString(strings.Join(hosts, ", ")))
		w.WriteString(`</span>`)
	}
	w.WriteString("</summary>")
	if len(images) > 1 {
		w.WriteString(`<span class="forum-img-row">`)
	}
	for i, img := range images {
		renderBlockImage(w, img, captions[i], lang)
	}
	if len(images) > 1 {
		w.WriteString(`</span>`)
	}
	w.WriteString("</details>\n")
	return ast.WalkSkipChildren, nil
}

// renderBlockImage is one picture of a block: a link to the original around the lazy <img>, and
// the line the forum script shows instead when the picture does not load (main.ts); without the
// script the browser shows its broken image with the caption.
func renderBlockImage(w util.BufWriter, img *ast.Image, caption []byte, lang string) {
	link, u, _ := blockImageURL(img)
	src := util.EscapeHTML(link)
	w.WriteString(`<a class="forum-img-link" href="`)
	w.Write(src)
	w.WriteString(`" rel="` + linkRel + `" target="_blank">`)
	w.WriteString(`<img class="forum-img" src="`)
	w.Write(src)
	w.WriteString(`" alt="`)
	w.Write(caption)
	w.WriteByte('"')
	switch {
	case img.Title != nil:
		w.WriteString(` title="`)
		html.DefaultWriter.Write(w, img.Title)
		w.WriteByte('"')
	case len(caption) > 0:
		w.WriteString(` title="`)
		w.Write(caption)
		w.WriteByte('"')
	}
	// no-referrer: the host learns neither the topic nor the site.
	w.WriteString(` loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>`)
	w.WriteString(`<a class="forum-img-broken" href="`)
	w.Write(src)
	w.WriteString(`" rel="` + linkRel + `" target="_blank" hidden>`)
	w.WriteString(stdhtml.EscapeString(i18n.T(lang, "forum.posts.imageBroken")))
	if len(caption) > 0 {
		w.WriteString(": ")
		w.Write(caption)
	}
	w.WriteString(" · ")
	w.WriteString(stdhtml.EscapeString(u.Hostname()))
	w.WriteString("</a>")
}

// imageCaption is the text of the picture's caption as HTML, without its marks.
func imageCaption(img *ast.Image, source []byte) []byte {
	var buf bytes.Buffer
	w := bufio.NewWriter(&buf)
	ast.Walk(img, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n := n.(type) {
		case *ast.Text:
			html.DefaultWriter.Write(w, n.Segment.Value(source))
			if n.SoftLineBreak() || n.HardLineBreak() {
				w.WriteByte(' ')
			}
		case *ast.String:
			w.Write(util.EscapeHTML(n.Value))
		}
		return ast.WalkContinue, nil
	})
	w.Flush()
	return bytes.TrimSpace(buf.Bytes())
}

// imagesCookie keeps the menu's "Pictures at once" as densityCookie keeps the density: "open", or
// no cookie for pictures under a spoiler (extras/decisions.md, 12).
const imagesCookie = "forum_images"

const imagesOpen = "open"

func imagesOpenFromRequest(r *http.Request) bool {
	c, err := r.Cookie(imagesCookie)
	return err == nil && c.Value == imagesOpen
}

// setImages is the menu item "Pictures at once", a form as the density's items are.
func (f *Forum) setImages(w http.ResponseWriter, r *http.Request, v view) {
	c := densityCookieOf("", -1)
	c.Name = imagesCookie
	switch r.PostFormValue("images") {
	case imagesOpen:
		c.Value, c.MaxAge = imagesOpen, 365*24*60*60
	case "closed":
		// The default is no cookie, as with the density.
	default:
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	http.SetCookie(w, c)
	http.Redirect(w, r, forumRedirect(r.PostFormValue("redirect")), http.StatusSeeOther)
}
