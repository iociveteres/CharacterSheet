import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { ConnectionBar, listenConnection } from "./connectionBar";

let root: HTMLElement;
const bar = () => root.querySelector(".connection-bar")?.textContent ?? null;
const ws = (type: string, detail?: unknown) => act(() => {
    document.dispatchEvent(new CustomEvent(`ws:${type}`, { detail }));
});

beforeAll(() => {
    listenConnection();
    root = document.createElement("div");
    document.body.append(root);
    act(() => render(<ConnectionBar />, root));
});

describe("the connection bar", () => {
    beforeEach(() => ws("reconnected"));

    it("shows nothing while the socket is open", () => {
        expect(root.innerHTML).toBe("");
    });

    it("says the page is reconnecting from a drop until the socket is back", () => {
        ws("disconnected");
        expect(bar()).toBe("No connection. Reconnecting…");

        ws("reconnected");
        expect(bar()).toBe(null);
    });

    it("leaves a socket that stopped reconnecting to the page's own notice", () => {
        ws("disconnected");
        act(() => {
            window.dispatchEvent(new CustomEvent("ws:connectionLost", { detail: { reason: "signedOut" } }));
        });

        expect(bar()).toBe(null);
    });
});

describe("the server's hello", () => {
    // The room page names the hash of its bundle (view_room.html).
    const page = document.createElement("div");
    page.dataset.build = "abc12345";
    beforeAll(() => document.body.append(page));
    afterEach(() => ws("hello", { type: "hello", build: "abc12345" }));

    it("with another build than the page's offers to reload, over a drop too", () => {
        const reload = vi.fn();
        vi.stubGlobal("location", { ...window.location, reload });
        try {
            ws("hello", { type: "hello", build: "def67890" });
            expect(bar()).toBe("A new version is out: reload the page to go on editing.Reload");
            ws("disconnected");
            expect(bar(), "the reload is the way out of a drop too").toContain("A new version is out");

            act(() => root.querySelector<HTMLButtonElement>(".connection-bar button")!.click());
            expect(reload).toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
            ws("reconnected");
        }
    });

    it("with the page's build shows nothing", () => {
        ws("hello", { type: "hello", build: "abc12345" });
        expect(root.innerHTML).toBe("");
    });
});
