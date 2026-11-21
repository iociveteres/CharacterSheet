import { afterEach, describe, expect, it, vi } from "vitest";
import { closePreview, openPreview, tabField } from "./preview";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Node[]): HTMLElementTagNameMap[K] {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

function tab(name: "text" | "preview", current: boolean): HTMLButtonElement {
    const button = el("button", { className: current ? "tab current" : "tab", type: current ? "button" : "submit" });
    button.dataset.tab = name;
    if (current) button.setAttribute("aria-current", "true");
    else button.name = name === "preview" ? "preview" : "write";
    return button;
}

// The reply form on its Text tab, as internal/forum/templates/editor.html draws it.
function replyForm() {
    const text = tab("text", true);
    const preview = tab("preview", false);
    const field = el("textarea", { id: "forum-reply-body", name: "body", value: "**hi**" });
    const form = el("form", { id: "reply", action: "/forum/topic/1/reply#reply", method: "POST" },
        el("input", { type: "hidden", name: "csrf_token", value: "token" }),
        el("div", { className: "forum-tabs-bar" }, text, preview),
        field);
    form.requestSubmit = vi.fn();
    document.body.append(form);
    return { form, field, text, preview };
}

function answer(response: Response | Promise<Response>) {
    const fetch = vi.fn(() => Promise.resolve(response));
    vi.stubGlobal("fetch", fetch);
    return fetch;
}

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe("openPreview", () => {
    it("shows the server's fragment in the place of the field without a reload", async () => {
        const { form, field, text, preview } = replyForm();
        const fetch = answer(new Response("<p><strong>hi</strong></p>", { status: 200 }));

        await openPreview(preview, field);

        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/forum/preview");
        expect(init.method).toBe("POST");
        expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ csrf_token: "token", body: "**hi**" });
        const shown = form.querySelector(".tab-preview.forum-post-body")!;
        expect(shown.id).toBe("forum-reply-body-preview");
        expect(shown.innerHTML).toBe("<p><strong>hi</strong></p>");
        expect(field.hidden).toBe(true);
        expect(form.requestSubmit).not.toHaveBeenCalled();
        // The tabs as the server would draw them on the Preview tab.
        expect(preview.classList.contains("current")).toBe(true);
        expect(preview.type).toBe("button");
        expect(preview.getAttribute("aria-current")).toBe("true");
        expect(text.classList.contains("current")).toBe(false);
        expect(text.type).toBe("submit");
        expect(text.hasAttribute("aria-current")).toBe(false);

        closePreview(form);
        expect(form.querySelector(".tab-preview")).toBeNull();
        expect(field.hidden).toBe(false);
        expect(field.value).toBe("**hi**");
        expect(text.classList.contains("current")).toBe(true);
        expect(preview.type).toBe("submit");
    });

    it("submits the form with the tab when the network fails", async () => {
        const { form, field, preview } = replyForm();
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));

        await openPreview(preview, field);

        expect(form.requestSubmit).toHaveBeenCalledWith(preview);
        expect(form.querySelector(".tab-preview")).toBeNull();
        expect(field.hidden).toBe(false);
    });

    it("submits the form with the tab when the server refuses the fragment", async () => {
        const { form, field, preview } = replyForm();
        answer(new Response("too long", { status: 422 }));

        await openPreview(preview, field);

        expect(form.requestSubmit).toHaveBeenCalledWith(preview);
        expect(form.querySelector(".tab-preview")).toBeNull();
    });

    it("drops a fragment that comes after the writer went back to the text", async () => {
        const { form, field, preview } = replyForm();
        let resolve!: (r: Response) => void;
        answer(new Promise<Response>(r => { resolve = r; }));

        const pending = openPreview(preview, field);
        closePreview(form);
        resolve(new Response("<p>late</p>", { status: 200 }));
        await pending;

        expect(form.querySelector(".tab-preview")).toBeNull();
        expect(field.hidden).toBe(false);
        expect(form.requestSubmit).not.toHaveBeenCalled();
    });
});

describe("tabField", () => {
    it("leaves a form the server drew on its Preview tab to the server", () => {
        const text = tab("text", false);
        el("form", {},
            el("div", { className: "forum-tabs-bar" }, text, tab("preview", true)),
            el("input", { type: "hidden", name: "body", value: "x" }));
        expect(tabField(text)).toBeNull();
    });

    it("finds the field of a form on its Text tab", () => {
        const { field, preview } = replyForm();
        expect(tabField(preview)).toBe(field);
    });
});
