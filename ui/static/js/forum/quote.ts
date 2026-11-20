// Quote with a selection: the selected part of a post goes into the reply form as Markdown, under
// the head the server put on the post (data-quote-head, internal/forum/quoting.go). The Markdown is
// rebuilt from the rendered post, so that it renders as the selection looked; the format of the
// quote is the server's quoteText.

const BLOCKS = new Set(["P", "DIV", "PRE", "UL", "OL", "LI", "BLOCKQUOTE", "HR", "H1", "H2", "H3", "H4", "H5", "H6", "DETAILS"]);

/** The quote of the post `article` to put into the reply form: the selection when it lies in the
 * text of this post, else the whole text; null when the post offers no Quote. */
export function quoteOf(article: Element, selection: Selection | null): string | null {
    const head = article.getAttribute("data-quote-head");
    const body = article.querySelector(".forum-post-body");
    if (!head || !body) return null;
    let markdown = "";
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const range = rangeInPost(selection.getRangeAt(0), article, body);
        if (range) markdown = toMarkdown(selectedFragment(range, body));
    }
    // A selection of nothing quotable (a quote inside the post, the author's name) quotes the post.
    if (!markdown) markdown = toMarkdown(body);
    return quoteText(head, markdown);
}

/** The quote as the server's quoteText writes it: the head, a blank quote line, the text line by
 * line, and an empty line for the reply. */
export function quoteText(head: string, markdown: string): string {
    let text = head + "\n";
    if (markdown) {
        text += ">\n";
        for (const line of markdown.split("\n")) text += line ? `> ${line}\n` : ">\n";
    }
    return text + "\n";
}

/** The part of `range` within the text of the post, or null when the selection reaches another
 * post or lies outside the text. A selection that runs on into the post's bottom line (a triple
 * click does) is cut to the text. */
export function rangeInPost(range: Range, article: Element, body: Element): Range | null {
    if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) return null;
    const whole = body.ownerDocument.createRange();
    whole.selectNodeContents(body);
    const start = whole.comparePoint(range.startContainer, range.startOffset);
    const end = whole.comparePoint(range.endContainer, range.endOffset);
    if (start > 0 || end < 0) return null;
    const cut = range.cloneRange();
    if (start < 0) cut.setStart(body, 0);
    if (end > 0) cut.setEnd(body, body.childNodes.length);
    return cut.collapsed ? null : cut;
}

/** The selected nodes inside the elements that hold them up to the post's text: a selection within
 * one code span or spoiler keeps being code or a spoiler. */
export function selectedFragment(range: Range, body: Element): Node {
    let node: Node = range.cloneContents();
    for (let at: Node | null = range.commonAncestorContainer; at && at !== body; at = at.parentNode) {
        if (at.nodeType !== Node.ELEMENT_NODE) continue;
        const shell = at.cloneNode(false);
        shell.appendChild(node);
        node = shell;
    }
    // A container, so that the outermost shell is read as a block of the text, as in the post.
    const fragment = body.ownerDocument.createDocumentFragment();
    fragment.appendChild(node);
    return fragment;
}

/** Markdown that renders as the rendered post `root` (internal/forum/markdown.go): paragraphs,
 * line breaks, emphasis, code, links, lists, headings, ||spoilers|| and pictures. Quotes inside the post are
 * left out, as the server leaves them out of a quote: a quote holds one level. */
export function toMarkdown(root: Node): string {
    return blocks(root).join("\n\n");
}

function blocks(container: Node): string[] {
    const out: string[] = [];
    let run = "";
    const flush = () => {
        const text = paragraph(run);
        if (text) out.push(text);
        run = "";
    };
    for (const child of Array.from(container.childNodes)) {
        if (child instanceof Element && BLOCKS.has(child.tagName)) {
            flush();
            const text = block(child);
            if (text) out.push(text);
        } else {
            run += inline(child);
        }
    }
    flush();
    return out;
}

function block(el: Element): string {
    switch (el.tagName) {
        case "BLOCKQUOTE":
            return "";
        case "PRE":
            return fence(el);
        case "UL":
        case "OL":
            return list(el);
        case "LI":
            // A selection inside one item: its list was cut away with the rest of the post.
            return item("- ", el);
        case "HR":
            return "***";
        case "DETAILS":
            return el.classList.contains("forum-img-spoiler") ? pictures(el) : blocks(el).join("\n\n");
        case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
            const text = paragraph(Array.from(el.childNodes).map(inline).join("")).replace(/\n/g, " ");
            return text && "#".repeat(Number(el.tagName[1])) + " " + text;
        }
        default:
            return blocks(el).join("\n\n");
    }
}

function list(el: Element): string {
    const ordered = el.tagName === "OL";
    let n = ordered ? Number(el.getAttribute("start") ?? "1") : 0;
    if (!Number.isFinite(n)) n = 1;
    const items: string[] = [];
    for (const li of Array.from(el.children)) {
        if (li.tagName !== "LI") continue;
        const text = item(ordered ? `${n}. ` : "- ", li);
        n++;
        if (text) items.push(text);
    }
    return items.join("\n");
}

// The lines after the first are indented under the marker, so that they stay in the item.
function item(marker: string, li: Element): string {
    const text = blocks(li).join("\n\n");
    if (!text) return "";
    const indent = " ".repeat(marker.length);
    return marker + text.split("\n").map((line, i) => (i === 0 || !line ? line : indent + line)).join("\n");
}

function fence(pre: Element): string {
    const code = pre.querySelector("code") ?? pre;
    const text = (code.textContent ?? "").replace(/\n$/, "");
    if (!text) return "";
    const language = /(?:^|\s)language-(\S+)/.exec(code.getAttribute("class") ?? "")?.[1] ?? "";
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
    const bar = "`".repeat(Math.max(3, longest + 1));
    return `${bar}${language}\n${text}\n${bar}`;
}

function inline(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeText((node.nodeValue ?? "").replace(/[ \t\r\n]+/g, " "));
    if (!(node instanceof Element)) return "";
    const inner = () => Array.from(node.childNodes).map(inline).join("");
    switch (node.tagName) {
        case "BR":
            return "\n";
        case "STRONG":
        case "B":
            return wrap("**", inner());
        case "EM":
        case "I":
            return wrap("*", inner());
        case "CODE":
            return codeSpan(node.textContent ?? "");
        case "A":
            // A picture that stays a link (http, past the limit of blocks): a picture again.
            if (node.classList.contains("forum-img-off")) {
                const href = node.getAttribute("href") ?? "";
                return picture(node.textContent === href ? "" : inner(), href);
            }
            return link(node, inner());
        case "SPAN":
            if (node.classList.contains("spoiler")) return wrap("||", inner());
            // The head of a quote the post holds: the quote itself is left out.
            if (node.classList.contains("quote-head")) return "";
            return inner();
        default:
            return inner();
    }
}

// Marks around the text, the spaces at its ends kept outside: "** bold**" is no emphasis.
function wrap(mark: string, text: string): string {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
    if (!m[2]) return text;
    return m[1] + mark + m[2] + mark + m[3];
}

function codeSpan(text: string): string {
    const code = text.replace(/\n/g, " ");
    if (!code) return "";
    const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map(run => run.length));
    const bar = "`".repeat(longest + 1);
    // CommonMark strips one space at both ends: one is added where the code itself begins or ends
    // with a backtick or with spaces on both sides.
    const pad = /^`|`$/.test(code) || (/^ [\s\S]* $/.test(code) && code.trim()) ? " " : "";
    return bar + pad + code + pad + bar;
}

// A block of pictures (images.go) is the pictures of its run on one line, so that they render as one
// block again; its line (caption, host) and the line of a broken picture are the server's words.
function pictures(details: Element): string {
    const images = Array.from(details.querySelectorAll("img.forum-img"))
        .map(img => picture(escapeText(img.getAttribute("alt") ?? ""), img.getAttribute("src") ?? ""))
        .filter(Boolean)
        .join(" ");
    return images && details.classList.contains("in-spoiler") ? `||${images}||` : images;
}

function picture(caption: string, src: string): string {
    return src ? `![${caption}](${destination(src)})` : caption;
}

function destination(href: string): string {
    return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href;
}

function link(a: Element, text: string): string {
    const href = a.getAttribute("href") ?? "";
    if (!href) return text;
    // An address written as it is (the renderer makes it a link): an autolink keeps it whole.
    if (a.textContent === href && /^[a-z][a-z0-9+.-]*:[^\s<>]*$/i.test(href)) return `<${href}>`;
    return `[${text}](${destination(href)})`;
}

// The characters that would make plain text markup inside a line.
function escapeText(text: string): string {
    return text.replace(/[\\`*_[\]<]/g, "\\$&").replace(/\|\|/g, "\\|\\|").replace(/&(?=[#a-zA-Z])/g, "\\&");
}

// A paragraph out of a run of inline Markdown: no spaces at the ends of lines (four would make code,
// two a line break), and plain text at the start of a line that would begin a block escaped.
function paragraph(run: string): string {
    return run
        .split("\n")
        .map(line => escapeLineStart(line.trim()))
        .join("\n")
        .trim();
}

function escapeLineStart(line: string): string {
    const ordered = /^\d{1,9}(?=[.)](\s|$))/.exec(line);
    if (ordered) return ordered[0] + "\\" + line.slice(ordered[0].length);
    if (/^(#{1,6}|[+-])(\s|$)|^>|^~{3}|^[=-]+$/.test(line)) return "\\" + line;
    return line;
}
