import { afterEach, describe, expect, it } from "vitest";
import "./main";

function el(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
}

// One picture of a block as internal/forum/images.go renders it.
function picture() {
    const img = el("img", { class: "forum-img", src: "https://i.example.com/a.png", alt: "map", loading: "lazy" }) as HTMLImageElement;
    const link = el("a", { class: "forum-img-link", href: "https://i.example.com/a.png" }, img);
    const line = el("a", { class: "forum-img-broken", href: "https://i.example.com/a.png", hidden: "" }, "…");
    document.body.append(el("div", { id: "forum" },
        el("details", { class: "forum-img-spoiler", open: "" }, el("summary", {}, "🖼 map"), link, line)));
    return { img, link, line };
}

afterEach(() => {
    document.body.replaceChildren();
});

describe("a picture that did not load", () => {
    it("gives its place to the server's line with the link", () => {
        const { img, link, line } = picture();
        // error does not bubble: the script hears it in the capture phase.
        img.dispatchEvent(new Event("error"));
        expect(link.hidden).toBe(true);
        expect(line.hidden).toBe(false);
        // The picture stays, for a quote to find its caption and address.
        expect(img.isConnected).toBe(true);
    });

    it("leaves a picture that loaded and other broken images alone", () => {
        const { img, link, line } = picture();
        img.dispatchEvent(new Event("load"));
        const avatar = el("img", { src: "/avatar/x" });
        const holder = el("a", { class: "forum-img-link" }, avatar);
        document.body.append(holder);
        avatar.dispatchEvent(new Event("error"));
        expect(link.hidden).toBe(false);
        expect(line.hidden).toBe(true);
        expect(holder.hidden).toBe(false);
    });
});
