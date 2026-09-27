import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import Sortable from "sortablejs";
import { Characters } from "./Characters";
import { folders, initRoomState, players, sheets } from "../state";
import { listenRemote } from "../remote";
import { answerConfirm } from "../actions";
import type { RoomPayload } from "../payload.gen";

let root: HTMLElement;
const sent: { type: string; [key: string]: unknown }[] = [];
const recordSent = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));

const $ = (selector: string) => root.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
const mine = '.player[data-user-id="1"]';

function receive(msg: { type: string; [key: string]: unknown }): void {
    act(() => {
        document.dispatchEvent(new CustomEvent(`ws:${msg.type}`, { detail: msg }));
    });
}

function click(element: Element): void {
    act(() => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

function pick(select: HTMLSelectElement, value: string): void {
    act(() => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

const sheet = (id: number, name: string, visibility: string, folderId: number | null = null) =>
    ({ id, name, kind: "black_crusade", visibility, folderId, createdAt: "2026-01-05T10:00:00Z", updatedAt: "2026-09-27T10:00:00Z" });

function mount(role: "gamemaster" | "moderator" | "player"): void {
    initRoomState({
        roomId: 5,
        csrfToken: "",
        inviteLink: "",
        players: [
            {
                id: 1, name: "Me", role, joinedAt: "",
                folders: [{ id: 10, name: "Heretics", visibility: "everyone_can_view", sortOrder: 0 }],
                sheets: [sheet(100, "Kharn", "everyone_can_view", 10), sheet(101, "", "everyone_can_view")],
            },
            {
                id: 2, name: "Other", role: "player", joinedAt: "",
                folders: [
                    { id: 20, name: "Open", visibility: "everyone_can_see", sortOrder: 0 },
                    { id: 21, name: "Hidden", visibility: "hide_from_players", sortOrder: 1 },
                ],
                sheets: [sheet(200, "Lorgar", "everyone_can_view"), sheet(201, "Seen", "everyone_can_see"), sheet(202, "In open", "everyone_can_edit", 20)],
            },
        ],
        chat: { messages: [], hasMore: false },
        commands: [],
        dicePresets: [],
        sheetKinds: [{ kind: "black_crusade", label: "Black Crusade" }, { kind: "pathfinder_crusade", label: "Pathfinder Crusade" }],
    } as unknown as RoomPayload);
    act(() => render(<Characters />, root));
}

beforeAll(() => listenRemote());

beforeEach(() => {
    localStorage.clear();
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
    vi.useRealTimers();
});

describe("my characters", () => {
    beforeEach(() => mount("player"));

    it("show my folders with their sheets, and my sheets outside them with their visibility", () => {
        expect($$(`${mine} .folder .folder-name-input`).map(i => (i as HTMLInputElement).value)).toEqual(["Heretics"]);
        expect($$(`${mine} .folder-sheets .character-sheet-entry`).map(e => e.dataset.sheetId)).toEqual(["100"]);
        expect($$(`${mine} .default-area .character-sheet-entry`).map(e => e.dataset.sheetId)).toEqual(["101"]);
        expect($(`${mine} .default-area .name a`)!.textContent).toBe("_____");
        expect($(`${mine} .default-area select`)).not.toBeNull();
        expect($(`${mine} .folder-sheets select`)).toBeNull();
        expect($$(`${mine} .delete-entry`)).toHaveLength(2);
    });

    it("name the kind and the dates of a sheet", () => {
        const row = $('[data-sheet-id="101"]')!;

        expect(row.querySelector(".meta.system")!.textContent).toBe("Black Crusade");
        expect(row.querySelector(".meta.updated")!.textContent).toMatch(/^Modified 27 Sep 2026 at \d\d:00$/);
        expect(row.querySelector(".meta.updated")!.getAttribute("title")).toMatch(/^Created 05 Jan 2026 at \d\d:00\nModified 27 Sep 2026 at \d\d:00$/);
    });

    it("send a new sheet of the picked kind and remember the kind", () => {
        pick($(".sheet-kind-select") as HTMLSelectElement, "pathfinder_crusade");
        click($(".button-wide.button-large")!);

        expect(sent).toEqual([{ type: "newCharacter", kind: "pathfinder_crusade", eventID: expect.any(String) }]);
        expect(localStorage.getItem("newSheetKind")).toBe("pathfinder_crusade");
    });

    it("send a sheet's visibility from its select", () => {
        pick($(`${mine} .default-area select`) as HTMLSelectElement, "hide_from_players");

        expect(sent).toEqual([{ type: "changeSheetVisibility", sheetID: "101", visibility: "hide_from_players", eventID: expect.any(String) }]);
    });

    it("keep a folder collapsed until the player opens it, across renders", () => {
        const header = () => $(`${mine} .folder-header`)!;
        expect(header().classList.contains("collapsed")).toBe(true);

        click($(`${mine} .folder-collapse-btn`)!);

        expect(header().classList.contains("collapsed")).toBe(false);
        expect(localStorage.getItem("folder_collapsed_5_10")).toBe("false");
    });
});

describe("the name of my folder", () => {
    beforeEach(() => mount("player"));

    const input = () => $(`${mine} .folder-name-input`) as HTMLInputElement;

    function type(text: string): void {
        act(() => {
            input().value = text;
            input().dispatchEvent(new Event("input", { bubbles: true }));
        });
    }

    it("keeps what the player types while their earlier name comes back", () => {
        vi.useFakeTimers();
        type("Her");
        act(() => {
            vi.advanceTimersByTime(500);
        });
        type("Heresy");

        receive({ type: "updateFolder", eventID: "e", folderId: 10, name: "Her", visibility: "everyone_can_view" });

        expect(input().value).toBe("Heresy");
        act(() => {
            vi.advanceTimersByTime(500);
        });
        expect(sent.map(m => m.name)).toEqual(["Her", "Heresy"]);
        expect(input().value).toBe("Heresy");
    });

    it("shows a rename from elsewhere", () => {
        receive({ type: "updateFolder", eventID: "e", folderId: 10, name: "Renamed", visibility: "everyone_can_view" });

        expect(input().value).toBe("Renamed");
    });
});

describe("characters of others", () => {
    const names = () => $$('.player[data-user-id="2"] .character-sheet-entry .name').map(n => `${n.firstElementChild!.tagName} ${n.textContent}`);

    it("show a player what they may see, as links where they may open it", () => {
        mount("player");

        expect($$('.player[data-user-id="2"] .folder-name-display').map(e => e.textContent)).toEqual(["Open"]);
        expect(names()).toEqual(["SPAN In open", "A Lorgar", "SPAN Seen"]);
        expect($$('.player[data-user-id="2"] .delete-entry')).toHaveLength(0);
        expect($$('.player[data-user-id="2"] select, .player[data-user-id="2"] .sheet-drag-handle, .player[data-user-id="2"] .folder-drag-handle')).toHaveLength(0);
    });

    it("let a moderator open and delete what they see, hidden folders stay hidden", () => {
        mount("moderator");

        expect($$('.player[data-user-id="2"] .folder-name-display').map(e => e.textContent)).toEqual(["Open"]);
        expect(names()).toEqual(["A In open", "A Lorgar", "A Seen"]);
        expect($$('.player[data-user-id="2"] .delete-entry')).toHaveLength(3);
    });

    it("show the gamemaster hidden folders", () => {
        mount("gamemaster");

        expect($$('.player[data-user-id="2"] .folder-name-display').map(e => e.textContent)).toEqual(["Open", "Hidden"]);
    });

    it("follow a role change of mine", () => {
        mount("player");

        receive({ type: "changePlayerRole", eventID: "e", userID: 1, role: "moderator" });

        expect($$('.player[data-user-id="2"] .delete-entry')).toHaveLength(3);
    });

    it("go with a kicked player", () => {
        mount("player");

        receive({ type: "kickPlayer", eventID: "e", userID: 2 });

        expect($('.player[data-user-id="2"]')).toBeNull();
    });
});

describe("dragging", () => {
    beforeEach(() => mount("player"));

    /**
     * Calls Sortable's handlers of `list` as a drag of `item` into `to` at
     * `index` would. `meanwhile` runs mid-drag, and the list renders what it
     * changes unless it is frozen; `rendered` sees that render.
     */
    function drag(list: HTMLElement, item: HTMLElement, to: HTMLElement, index: number, meanwhile = () => {}, rendered = () => {}): void {
        const { options } = Sortable.get(list)!;
        act(() => {
            options.onStart!({ item } as Sortable.SortableEvent);
            to.insertBefore(item, to.children[index] ?? null);
        });
        act(meanwhile);
        rendered();
        act(() => options.onEnd!({ item, from: list, to } as Sortable.SortableEvent));
    }

    it("moves a sheet into a folder: the node goes back and Preact moves it", () => {
        const defaultArea = $(`${mine} .default-area`)!;
        const folderSheets = $(`${mine} .folder-sheets`)!;
        const row = $('[data-sheet-id="101"]')!;

        drag(defaultArea, row, folderSheets, 1);

        expect(sent).toEqual([{ type: "moveSheetToFolder", sheetId: 101, folderId: 10, eventID: expect.any(String) }]);
        expect($$(`${mine} .folder-sheets .character-sheet-entry`).map(e => e.dataset.sheetId)).toEqual(["100", "101"]);
        expect($$('[data-sheet-id="101"]')).toHaveLength(1);
        expect(defaultArea.children).toHaveLength(0);
    });

    it("moves a sheet out of its folder", () => {
        drag($(`${mine} .folder-sheets`)!, $('[data-sheet-id="100"]')!, $(`${mine} .default-area`)!, 0);

        expect(sheets.value.find(s => s.id === 100)!.folderId).toBeNull();
        expect($$(`${mine} .default-area .character-sheet-entry`).map(e => e.dataset.sheetId)).toEqual(["100", "101"]);
    });

    it("puts a sheet moved within its list back: the list has no order of its own", () => {
        receive({ type: "moveSheetToFolder", eventID: "e", sheetId: 100, folderId: null });
        const defaultArea = $(`${mine} .default-area`)!;
        const ids = () => [...defaultArea.children].map(e => (e as HTMLElement).dataset.sheetId);
        expect(ids()).toEqual(["100", "101"]);

        drag(defaultArea, $('[data-sheet-id="101"]')!, defaultArea, 0);

        expect(sent).toEqual([]);
        expect(ids()).toEqual(["100", "101"]);
    });

    it("renders the changes that came during the drag after the drop", () => {
        const created = new Date().toISOString();
        let midDrag: (string | undefined)[] = [];

        drag($(`${mine} .default-area`)!, $('[data-sheet-id="101"]')!, $(`${mine} .folder-sheets`)!, 1, () => {
            receive({ type: "newCharacterItem", eventID: "e", userID: 1, sheetID: 102, name: "New", kind: "black_crusade", created, updated: created });
            receive({ type: "change", eventID: "e", sheetID: "101", path: "characterInfo.characterName", change: "Abaddon" });
        }, () => {
            midDrag = $$(`${mine} .character-sheet-entry`).map(e => e.dataset.sheetId);
        });

        expect(midDrag).toEqual(["100", "101"]);
        expect($$(`${mine} .default-area .character-sheet-entry`).map(e => e.dataset.sheetId)).toEqual(["102"]);
        expect($$(`${mine} .folder-sheets .character-sheet-entry .name a`).map(a => a.textContent)).toEqual(["Kharn", "Abaddon"]);
    });

    it("reorders my folders", () => {
        receive({ type: "folderCreated", eventID: "e", folderId: 11, ownerId: 1, name: "Second", visibility: "everyone_can_view", sortOrder: 1, createdAt: "" });
        const list = $(`${mine} .folders-container`)!;

        drag(list, $('.folder[data-folder-id="11"]')!, list, 0);

        expect(sent).toEqual([{ type: "reorderFolders", folderIds: [11, 10], eventID: expect.any(String) }]);
        expect($$(`${mine} .folder`).map(f => f.dataset.folderId)).toEqual(["11", "10"]);
        expect(folders.value.map(f => [f.id, f.sortOrder])).toEqual([[10, 1], [20, 0], [21, 1], [11, 0]]);
    });
});

it("shows me first, then the others in their order", () => {
    mount("player");
    receive({ type: "newPlayer", eventID: "e", userID: 3, name: "New", joined: "" });

    expect($$(".player > .player-header .player-name").map(e => e.textContent)).toEqual(["Me", "Other", "New"]);
    expect(players.value).toHaveLength(3);
});
