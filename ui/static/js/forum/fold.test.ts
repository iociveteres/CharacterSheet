import { afterEach, describe, expect, it, vi } from "vitest";
import "./main";

function el(tag: string, attrs: Record<string, string> = {}, ...children: Node[]): HTMLElement {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
}

// A home with two parents, as home.html renders it: the arrow is a form with the section's id.
function home() {
    const parent = (id: string) => {
        const section = document.createElement("input");
        section.type = "hidden";
        section.name = "section";
        section.value = id;
        const button = el("button", { type: "submit", "aria-expanded": "true", title: "fold", "aria-label": "fold", "data-fold": "fold", "data-unfold": "unfold" });
        const form = el("form", { class: "forum-fold", method: "post", action: "/forum/view/fold" }, section, button) as HTMLFormElement;
        const row = el("li", { class: "forum-row forum-parent", "data-section": id }, form);
        const subs = [1, 2].map(() => el("li", { class: "forum-row forum-subrow", "data-parent": id }));
        return { row, form, button, subs };
    };
    const a = parent("2");
    const b = parent("3");
    document.body.append(el("ul", {}, a.row, ...a.subs, b.row, ...b.subs));
    return { a, b };
}

function submit(form: HTMLFormElement): boolean {
    return form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

describe("the fold arrow", () => {
    it("folds its parent and its subsections at once, leaves the other parent, and posts the form", () => {
        const fetch = vi.fn(() => Promise.resolve(new Response(null)));
        vi.stubGlobal("fetch", fetch);
        const { a, b } = home();

        expect(submit(a.form)).toBe(false);
        expect(a.row.classList.contains("folded")).toBe(true);
        expect(a.subs.every(row => row.classList.contains("folded"))).toBe(true);
        expect(b.row.classList.contains("folded")).toBe(false);
        expect(b.subs.some(row => row.classList.contains("folded"))).toBe(false);
        expect(a.button.getAttribute("aria-expanded")).toBe("false");
        expect(a.button.title).toBe("unfold");
        expect(a.button.getAttribute("aria-label")).toBe("unfold");

        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain("/forum/view/fold");
        expect(init.method).toBe("POST");
        expect((init.body as FormData).get("section")).toBe("2");
    });

    it("unfolds on the second press", () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null))));
        const { a } = home();
        submit(a.form);
        submit(a.form);
        expect(a.row.classList.contains("folded")).toBe(false);
        expect(a.subs.some(row => row.classList.contains("folded"))).toBe(false);
        expect(a.button.getAttribute("aria-expanded")).toBe("true");
        expect(a.button.title).toBe("fold");
    });

    it("leaves other forms to the browser", () => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        const form = el("form", { method: "post", action: "/forum/read" }) as HTMLFormElement;
        document.body.append(form);
        form.addEventListener("submit", event => event.preventDefault());
        submit(form);
        expect(fetch).not.toHaveBeenCalled();
    });
});
