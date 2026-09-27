import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { Players } from "./Players";
import { confirmMessage, initRoomState, modals } from "../state";
import { listenRemote } from "../remote";
import { answerConfirm } from "../actions";
import type { RoomPayload } from "../payload.gen";

let root: HTMLElement;
const sent: { type: string; [key: string]: unknown }[] = [];
const recordSent = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));

const $ = (selector: string) => root.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];

function click(element: Element): void {
    act(() => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

function mount(role: "gamemaster" | "moderator" | "player"): void {
    initRoomState({
        roomId: 5,
        csrfToken: "",
        inviteLink: "",
        players: [
            { id: 1, name: "Me", role, joinedAt: "2026-01-05T10:00:00Z", folders: [], sheets: [] },
            { id: 2, name: "Moderator", role: "moderator", joinedAt: "", folders: [], sheets: [] },
            { id: 3, name: "Player", role: "player", joinedAt: "", folders: [], sheets: [] },
        ],
        chat: { messages: [], hasMore: false },
        commands: [],
        dicePresets: [],
        sheetKinds: [],
    } as unknown as RoomPayload);
    act(() => render(<Players />, root));
}

beforeAll(() => listenRemote());

beforeEach(() => {
    document.addEventListener("room:sendMessage", recordSent);
    root = document.createElement("div");
    document.body.append(root);
});

afterEach(() => {
    act(() => answerConfirm(false));
    render(null, root);
    root.remove();
    document.removeEventListener("room:sendMessage", recordSent);
    sent.length = 0;
});

it("shows me first with my role and when I joined", () => {
    mount("player");

    expect($$(".player-name").map(e => e.textContent)).toEqual(["Me", "Moderator", "Player"]);
    expect($("#current-player .meta.role")!.textContent).toBe("player");
    expect($("#current-player .meta.created")!.textContent).toMatch(/^Joined at 05 Jan 2026 at \d\d:00$/);
});

describe("a player", () => {
    beforeEach(() => mount("player"));

    it("sees roles, and no invite, role selects or kicks", () => {
        expect($$(".player .meta.role").map(e => e.textContent)).toEqual(["player", "moderator", "player"]);
        expect($$("button")).toHaveLength(0);
        expect($$("select")).toHaveLength(0);
    });

    it("gets the gamemaster's controls with the role", () => {
        act(() => {
            document.dispatchEvent(new CustomEvent("ws:changePlayerRole", { detail: { type: "changePlayerRole", eventID: "e", userID: 1, role: "gamemaster" } }));
        });

        expect($$(".role-select")).toHaveLength(2);
    });
});

describe("the gamemaster", () => {
    beforeEach(() => mount("gamemaster"));

    it("opens the invite", () => {
        click($("button.button-wide")!);

        expect(modals.value.invite).toBe(true);
    });

    it("changes a role from its select", () => {
        const select = $('.player[data-user-id="3"] .role-select') as HTMLSelectElement;
        expect(select.value).toBe("player");

        act(() => {
            select.value = "moderator";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });

        expect(sent).toEqual([{ type: "changePlayerRole", userID: 3, role: "moderator", eventID: expect.any(String) }]);
        expect(($('.player[data-user-id="3"] .role-select') as HTMLSelectElement).value).toBe("moderator");
    });

    it("kicks a player after asking", async () => {
        click($('.player[data-user-id="2"] .delete-entry')!);
        expect(confirmMessage.value).toBe("Kick Moderator?");

        act(() => answerConfirm(true));
        await Promise.resolve();

        expect(sent).toEqual([{ type: "kickPlayer", userID: 2, eventID: expect.any(String) }]);
    });

    it("sees a kicked player go", () => {
        act(() => {
            document.dispatchEvent(new CustomEvent("ws:kickPlayer", { detail: { type: "kickPlayer", eventID: "e", userID: 2 } }));
        });

        expect($('.player[data-user-id="2"]')).toBeNull();
    });
});
