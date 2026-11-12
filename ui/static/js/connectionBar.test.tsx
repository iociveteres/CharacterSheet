import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
