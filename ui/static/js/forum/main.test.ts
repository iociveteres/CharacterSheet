import { afterEach, describe, expect, it } from "vitest";
import "./main";

function el(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
}

const HEAD = "> **alice** [wrote in #2](/forum/post/7):";

function topicPage(withForm: boolean) {
    const text = el("p", {}, "quoted words here");
    const spoiler = el("span", { class: "spoiler", tabindex: "0" }, "secret");
    const quote = el("a", { class: "forum-quote-post", href: "/forum/post/7/quote#reply" }, "Quote");
    const article = el("article", { class: "forum-post", "data-quote-head": HEAD },
        el("div", { class: "forum-post-main" },
            el("div", { class: "forum-post-body" }, text, el("p", {}, spoiler)),
            el("div", { class: "forum-post-actions" }, quote)));
    const field = document.createElement("textarea");
    field.name = "body";
    field.value = "my reply";
    document.body.append(el("div", { id: "forum" }, article, ...(withForm ? [el("form", { id: "reply" }, field)] : [])));
    return { text, spoiler, quote, field };
}

function click(target: Element): boolean {
    return target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
}

afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
});

describe("the forum script", () => {
    it("marks the page scripted, so that forum.css leaves the spoiler to it", () => {
        expect(document.documentElement.classList.contains("forum-js")).toBe(true);
    });

    it("quotes the selection into the reply form on the page, after what is written there", () => {
        const { text, quote, field } = topicPage(true);
        const range = document.createRange();
        range.setStart(text.firstChild!, 7);
        range.setEnd(text.firstChild!, 12);
        document.getSelection()!.addRange(range);

        expect(click(quote)).toBe(false);
        expect(field.value).toBe(`my reply\n\n${HEAD}\n>\n> words\n\n`);
    });

    it("leaves Quote a link when the reply form is on another page", () => {
        const { quote } = topicPage(false);
        expect(click(quote)).toBe(true);
    });

    it("opens and closes a spoiler by a click", () => {
        const { spoiler } = topicPage(true);
        click(spoiler);
        expect(spoiler.classList.contains("open")).toBe(true);
        click(spoiler);
        expect(spoiler.classList.contains("open")).toBe(false);
    });

    it("counts the characters of a field with a counter as they are typed", () => {
        const field = document.createElement("textarea");
        field.dataset.counter = "about-count";
        const counter = el("span", { id: "about-count" }, "0");
        document.body.append(el("div", { id: "forum" }, field, counter));
        field.value = "абв 😀";
        field.dispatchEvent(new Event("input", { bubbles: true }));
        expect(counter.textContent).toBe("5");
    });

    it("closes the former names of a user page by a click elsewhere or Esc", () => {
        const summary = el("summary", { class: "former-names-toggle" }, "▾");
        const name = el("span", { class: "former-name" }, "bob");
        const details = el("details", { class: "former-names", open: "" }, summary, el("div", { class: "former-names-panel" }, name)) as HTMLDetailsElement;
        const elsewhere = el("p", {}, "posts");
        document.body.append(el("div", { id: "forum" }, details, elsewhere));
        click(name);
        expect(details.open).toBe(true);
        click(elsewhere);
        expect(details.open).toBe(false);
        details.open = true;
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(details.open).toBe(false);
    });
});
