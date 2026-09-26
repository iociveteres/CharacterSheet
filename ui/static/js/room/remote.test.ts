import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listenRemote } from "./remote";
import { inviteLink, me, modals, toasts } from "./state";

const closed = { invite: false, import: false, kicked: false, connectionLost: false };

const receive = (msg: { type: string; [key: string]: unknown }) => document.dispatchEvent(new CustomEvent(`ws:${msg.type}`, { detail: msg }));

beforeAll(() => listenRemote());

beforeEach(() => {
    me.value = { id: 1, role: "player" };
    modals.value = closed;
});

afterEach(() => vi.useRealTimers());

describe("a kick", () => {
    it("of me shows the kicked modal", () => {
        receive({ type: "kickPlayer", eventID: "e", userID: 1 });

        expect(modals.value.kicked).toBe(true);
    });

    it("of another player leaves the page as it is", () => {
        receive({ type: "kickPlayer", eventID: "e", userID: 2 });

        expect(modals.value).toEqual(closed);
    });
});

describe("a role change", () => {
    it("of me changes my role", () => {
        receive({ type: "changePlayerRole", eventID: "e", userID: 1, role: "moderator" });

        expect(me.value).toEqual({ id: 1, role: "moderator" });
    });

    it("of me to a player closes the invite modal", () => {
        me.value = { id: 1, role: "moderator" };
        modals.value = { ...closed, invite: true };

        receive({ type: "changePlayerRole", eventID: "e", userID: 1, role: "player" });

        expect(modals.value).toEqual(closed);
    });

    it("of another player leaves mine", () => {
        receive({ type: "changePlayerRole", eventID: "e", userID: 2, role: "moderator" });

        expect(me.value.role).toBe("player");
    });
});

it("a new invite link replaces the shown one", () => {
    receive({ type: "newInviteLink", link: "http://localhost/invite/abc" });

    expect(inviteLink.value).toBe("http://localhost/invite/abc");
});

it("a lost connection shows its modal", () => {
    window.dispatchEvent(new CustomEvent("ws:connectionLost"));

    expect(modals.value.connectionLost).toBe(true);
});

describe("toasts", () => {
    const messages = () => toasts.value.map(t => t.message);

    it("show a notice of the sheet for five seconds, a repeated one once", () => {
        vi.useFakeTimers();
        const notice = (message: string) => document.dispatchEvent(new CustomEvent("sheet:notice", { detail: { message } }));

        notice("Not saved");
        vi.advanceTimersByTime(3000);
        notice("Other");
        notice("Not saved");
        expect(messages()).toEqual(["Other", "Not saved"]);

        // The repeated notice counts its five seconds from the repeat.
        vi.advanceTimersByTime(2500);
        expect(messages()).toEqual(["Other", "Not saved"]);
        vi.advanceTimersByTime(3000);
        expect(messages()).toEqual([]);
    });
});
