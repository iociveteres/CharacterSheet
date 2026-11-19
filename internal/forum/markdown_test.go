package forum

import (
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestRenderMarkdown(t *testing.T) {
	const rel = ` rel="nofollow ugc noopener"`
	tests := []struct {
		name, src, want string
	}{
		{"bold and italic", "**bold** *italic*", "<p><strong>bold</strong> <em>italic</em></p>"},
		{"link", `[site](https://example.com "Title")`,
			`<p><a href="https://example.com" title="Title"` + rel + `>site</a></p>`},
		{"lists", "- a\n- b\n\n1. x\n2. y",
			"<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<ol>\n<li>x</li>\n<li>y</li>\n</ol>"},
		{"quote", "> **Name** [wrote](/forum/post/123):\n> text",
			"<blockquote>\n<p><strong>Name</strong> <a href=\"/forum/post/123\">wrote</a>:<br>\ntext</p>\n</blockquote>"},
		{"inline code", "`a < b`", "<p><code>a &lt; b</code></p>"},
		{"code block", "```\n<b>x</b>\n```", "<pre><code>&lt;b&gt;x&lt;/b&gt;\n</code></pre>"},
		{"spoiler", "a ||secret|| b", `<p>a <span class="spoiler" tabindex="0">secret</span> b</p>`},
		{"spoiler with emphasis", "||**bold** end||",
			`<p><span class="spoiler" tabindex="0"><strong>bold</strong> end</span></p>`},

		{"script tag", "<script>alert(1)</script>", "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"},
		{"img onerror", "x <img src=x onerror=alert(1)> y", "<p>x &lt;img src=x onerror=alert(1)&gt; y</p>"},
		{"iframe", `<iframe src="https://example.com"></iframe>`,
			"<p>&lt;iframe src=&quot;https://example.com&quot;&gt;&lt;/iframe&gt;</p>"},
		{"html block", "<div onclick=\"alert(1)\">\nx\n</div>",
			"<p>&lt;div onclick=&quot;alert(1)&quot;&gt;<br>\nx<br>\n&lt;/div&gt;</p>"},
		{"quote breaking out of href", `[x](https://example.com/"onmouseover="alert(1))`,
			`<p><a href="https://example.com/%22onmouseover=%22alert(1)"` + rel + `>x</a></p>`},

		{"javascript link", "[x](javascript:alert(1))", "<p>x</p>"},
		{"javascript in capitals", "[x](JaVaScRiPt:alert(1))", "<p>x</p>"},
		{"javascript through an entity", "[x](&#106;avascript:alert(1))", "<p>x</p>"},
		{"javascript through a named entity", "[x](javascript&colon;alert(1))", "<p>x</p>"},
		{"javascript autolink", "<javascript:alert(1)>", "<p>javascript:alert(1)</p>"},
		{"data link", "[x](data:text/html,<b>hi</b>)", "<p>x</p>"},
		{"data link without html", "[x](data:text/html;base64,PGI+)", "<p>x</p>"},
		{"vbscript link", "[x](vbscript:msgbox(1))", "<p>x</p>"},

		{"image", "![caption](https://example.com/a.png)",
			`<p><a href="https://example.com/a.png"` + rel + `>caption</a></p>`},
		{"image without caption", "![](https://example.com/a.png)",
			`<p><a href="https://example.com/a.png"` + rel + `>https://example.com/a.png</a></p>`},
		{"data image", "![caption](data:image/png;base64,AAAA)", "<p>caption</p>"},
		{"data image without caption", "![](data:image/png;base64,AAAA)", "<p>data:image/png;base64,AAAA</p>"},

		{"link within the site", "[post](/forum/post/1)", `<p><a href="/forum/post/1">post</a></p>`},
		{"line break", "one\ntwo", "<p>one<br>\ntwo</p>"},
		{"bare address", "see https://example.com/x?a=1&b=2 now",
			`<p>see <a href="https://example.com/x?a=1&amp;b=2"` + rel + `>https://example.com/x?a=1&amp;b=2</a> now</p>`},
		{"bare www address", "www.example.com", `<p><a href="http://www.example.com"` + rel + `>www.example.com</a></p>`},
		{"bare ftp address", "ftp://example.com", "<p>ftp://example.com</p>"},

		{"spoiler with spaces inside the bars", "a || secret || b",
			`<p>a <span class="spoiler" tabindex="0"> secret </span> b</p>`},
		{"spoiler with a space on one side", "a|| secret||b",
			`<p>a<span class="spoiler" tabindex="0"> secret</span>b</p>`},
		{"spoiler without spaces outside the bars", "a||secret||b",
			`<p>a<span class="spoiler" tabindex="0">secret</span>b</p>`},
		{"two spoilers", "|| a || and || b ||",
			`<p><span class="spoiler" tabindex="0"> a </span> and <span class="spoiler" tabindex="0"> b </span></p>`},
		{"bars without a pair", "a || b", "<p>a || b</p>"},
		{"three single bars", "a | b || c | d", "<p>a | b || c | d</p>"},
		{"opening bars only", "||open", "<p>||open</p>"},
		{"three bars", "|||x|||", "<p>|||x|||</p>"},
		{"spoiler in inline code", "`||x||`", "<p><code>||x||</code></p>"},
		{"spoiler in a code block", "```\n||x||\n```", "<pre><code>||x||\n</code></pre>"},
		{"spoiler across paragraphs", "||a\n\nb||", "<p>||a</p>\n<p>b||</p>"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := renderMarkdown(tt.src)
			assert.NilError(t, err)
			assert.Equal(t, strings.TrimSpace(string(got)), tt.want)
		})
	}
}

func TestPlainText(t *testing.T) {
	tests := []struct {
		name, src string
		limit     int
		want      string
	}{
		{"marks go, words stay", "**bold**, *italic* and `code`", 100, "bold, italic and code"},
		{"link text, not its address", "see [the rules](https://example.com/rules)", 100, "see the rules"},
		{"bare address", "at https://example.com now", 100, "at https://example.com now"},
		{"spoiler left out", "the end: ||everyone dies|| really", 100, "the end: really"},
		{"code block left out", "before\n\n```\nfunc main() {}\n```\n\nafter", 100, "before after"},
		{"blocks and lines joined by spaces", "# Title\n\nline one\nline two\n\n- item\n> quote", 100, "Title line one line two item quote"},
		{"entities resolved", "Tom &amp; Jerry", 100, "Tom & Jerry"},
		{"short enough", "one two three", 13, "one two three"},
		{"cut at a word", "one two three four", 12, "one two…"},
		{"a word longer than the limit", "abcdefghijklmnop", 14, "abcdefghijklmn…"},
		{"nothing but a spoiler", "||secret||", 100, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, plainText(tt.src, tt.limit), tt.want)
		})
	}
}
