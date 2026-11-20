import { afterEach, describe, expect, it } from "vitest";
import { quoteOf, quoteText, toMarkdown } from "./quote";

type Child = Node | string;

function el(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
}

const HEAD = "> **alice** [wrote in #2](/forum/post/7):";

// A post as internal/forum/templates/post.html draws it, with the given rendered text.
function post(head: string | null, ...body: Child[]): { article: HTMLElement; body: HTMLElement } {
    const text = el("div", { class: "forum-post-body" }, ...body);
    const attrs: Record<string, string> = { class: "forum-post" };
    if (head) attrs["data-quote-head"] = head;
    const article = el("article", attrs,
        el("div", { class: "forum-post-author" }, el("span", { class: "name" }, "alice")),
        el("div", { class: "forum-post-main" },
            text,
            el("div", { class: "forum-post-foot" },
                el("div", { class: "forum-post-meta" }, el("a", { class: "num", href: "/forum/post/7" }, "#2")),
                el("div", { class: "forum-post-actions" }, el("a", { class: "forum-quote-post", href: "/forum/post/7/quote#reply" }, "Quote")))));
    document.body.append(article);
    return { article, body: text };
}

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Selection {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
}

const textOf = (node: Node) => node.firstChild!;

afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
});

describe("quoteOf", () => {
    it("quotes the selected part of one line under the head", () => {
        const p = el("p", {}, "Hello there, world");
        const { article } = post(HEAD, p);
        expect(quoteOf(article, select(textOf(p), 6, textOf(p), 11))).toBe(`${HEAD}\n>\n> there\n\n`);
    });

    it("keeps paragraphs and line breaks of a selection across them", () => {
        const first = el("p", {}, "one ", el("strong", {}, "two"), el("br"), "three");
        const second = el("p", {}, "four five");
        const { article } = post(HEAD, first, second);
        const quote = quoteOf(article, select(textOf(first), 1, textOf(second), 4));
        expect(quote).toBe(`${HEAD}\n>\n> ne **two**\n> three\n>\n> four\n\n`);
    });

    it("does not quote a selection across two posts: the post is quoted whole", () => {
        const a = el("p", {}, "first post");
        const b = el("p", {}, "second post");
        const { article } = post(HEAD, a);
        const other = post("> **bob** [wrote in #3](/forum/post/8):", b);
        const selection = select(textOf(a), 6, textOf(b), 6);
        expect(quoteOf(article, selection)).toBe(`${HEAD}\n>\n> first post\n\n`);
        expect(quoteOf(other.article, selection)).toBe("> **bob** [wrote in #3](/forum/post/8):\n>\n> second post\n\n");
    });

    it("keeps a spoiler and code that the selection is in or goes through", () => {
        const spoiler = el("span", { class: "spoiler", tabindex: "0" }, "the butler did it");
        const p = el("p", {}, "So ", spoiler, " and ", el("code", {}, "x = 1"), " end");
        const { article } = post(HEAD, p);
        // Inside the spoiler only: still a spoiler.
        expect(quoteOf(article, select(textOf(spoiler), 4, textOf(spoiler), 10))).toBe(`${HEAD}\n>\n> ||butler||\n\n`);
        // From the spoiler through the code.
        const last = p.lastChild!;
        expect(quoteOf(article, select(textOf(spoiler), 11, last, 2))).toBe(`${HEAD}\n>\n> ||did it|| and \`x = 1\` e\n\n`);
    });

    it("quotes a selection in a code block as a code block", () => {
        const code = el("code", { class: "language-go" }, "a := 1\nb := 2\n");
        const { article } = post(HEAD, el("pre", {}, code));
        expect(quoteOf(article, select(textOf(code), 0, textOf(code), 6))).toBe(`${HEAD}\n>\n> \`\`\`go\n> a := 1\n> \`\`\`\n\n`);
    });

    it("quotes the whole post without a selection, or with one outside its text", () => {
        const p = el("p", {}, "whole");
        const { article } = post(HEAD, p);
        expect(quoteOf(article, null)).toBe(`${HEAD}\n>\n> whole\n\n`);
        const name = article.querySelector(".name")!;
        expect(quoteOf(article, select(textOf(name), 0, textOf(name), 3))).toBe(`${HEAD}\n>\n> whole\n\n`);
    });

    it("cuts a selection that runs on under the post's actions to its text", () => {
        const p = el("p", {}, "kept text");
        const { article } = post(HEAD, p);
        const quote = article.querySelector(".forum-quote-post")!;
        expect(quoteOf(article, select(textOf(p), 5, textOf(quote), 0))).toBe(`${HEAD}\n>\n> text\n\n`);
    });

    it("leaves out the quotes the post holds", () => {
        const nested = el("blockquote", {},
            el("p", {}, el("span", { class: "quote-head" }, el("strong", {}, "bob"), " ", el("a", { href: "/forum/post/1" }, "wrote in #1"), ":"), "old words"));
        const { article } = post(HEAD, nested, el("p", {}, "my answer"));
        expect(quoteOf(article, null)).toBe(`${HEAD}\n>\n> my answer\n\n`);
    });

    it("offers nothing for a post without Quote", () => {
        const { article } = post(null, el("p", {}, "text"));
        expect(quoteOf(article, null)).toBeNull();
    });
});

describe("toMarkdown", () => {
    it("escapes plain text that would become markup", () => {
        const root = el("div", {}, el("p", {}, "*not bold* a_b [x] <b> ||no|| &amp;", el("br"), "1. not a list", el("br"), "# not a heading", el("br"), "> no quote"));
        expect(toMarkdown(root)).toBe(
            "\\*not bold\\* a\\_b \\[x\\] \\<b> \\|\\|no\\|\\| \\&amp;\n1\\. not a list\n\\# not a heading\n\\> no quote");
    });

    it("writes links, lists and headings back", () => {
        const root = el("div", {},
            el("h3", {}, "Title"),
            el("p", {}, el("a", { href: "https://example.com/a_b" }, "https://example.com/a_b"), " and ", el("a", { href: "/forum/post/3" }, "a ", el("em", {}, "post"))),
            el("ol", { start: "3" }, el("li", {}, "three"), el("li", {}, "four", el("ul", {}, el("li", {}, "inner")))));
        expect(toMarkdown(root)).toBe(
            "### Title\n\n<https://example.com/a_b> and [a *post*](/forum/post/3)\n\n3. three\n4. four\n\n   - inner");
    });

    it("picks fences longer than the backticks in code", () => {
        const root = el("div", {}, el("p", {}, el("code", {}, "a ` b")), el("pre", {}, el("code", {}, "```\n")));
        expect(toMarkdown(root)).toBe("``a ` b``\n\n````\n```\n````");
    });
});

describe("quoteText", () => {
    it("writes the head alone for an empty text", () => {
        expect(quoteText(HEAD, "")).toBe(`${HEAD}\n\n`);
    });
});
