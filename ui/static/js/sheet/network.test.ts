import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { online } from "./connection";
import { sheetTransport } from "./network";
import { createSheetActions, type SheetActions } from "./core/actions";
import { loadState } from "./components/testUtils";
import { createSheetInstance } from "./instance";
import type { SheetPayload } from "./payload";
import { readJson } from "./core/remote";
import { ABSENT } from "./versions";

// The room's socket as the sheet sees it: room:sendMessage out, ws:<type> in.
let sent: { eventID: string; type: string; sheetID: string }[];
let socketOpen: boolean;
const room = (e: Event) => {
    if (socketOpen) sent.push(JSON.parse((e as CustomEvent<string>).detail));
    else e.preventDefault();
};
const receive = (msg: { type: string; [key: string]: unknown }) =>
    document.dispatchEvent(new CustomEvent(`ws:${msg.type}`, { detail: msg }));

let failures: unknown[];
let sheetActions: SheetActions;
const record = (e: Event) => failures.push((e as CustomEvent).detail);

beforeEach(() => {
    sent = [];
    socketOpen = true;
    failures = [];
    sheetActions = createSheetActions(loadState({}), "black_crusade", sheetTransport("7"));
    document.addEventListener("room:sendMessage", room);
    document.addEventListener("sheet:editFailed", record);
});

afterEach(() => {
    document.removeEventListener("room:sendMessage", room);
    document.removeEventListener("sheet:editFailed", record);
    vi.useRealTimers();
});

describe("edits of the sheet", () => {
    it("are reported when the server rejects them, not when it accepts them", () => {
        sheetActions.deleteItem("talents.list.items.t1");
        sheetActions.deleteItem("talents.list.items.t2");
        const [accepted, rejected] = sent;

        receive({ type: "response", eventID: accepted.eventID, OK: true, version: 3 });
        receive({ type: "response", eventID: rejected.eventID, OK: false, code: "permission" });
        // Answers to messages that are not sheet edits, and a second answer, are not edits.
        receive({ type: "response", eventID: "chat-1", OK: false, code: "validation" });
        receive({ type: "response", eventID: rejected.eventID, OK: false, code: "permission" });

        expect(failures).toEqual([{ sheetID: "7", reason: "permission" }]);
    });

    it("are not sent when they are larger than the server takes", () => {
        vi.useFakeTimers();
        sheetActions.change("notes.list.items.n1.description", "ж".repeat(17 * 1024));
        vi.advanceTimersByTime(200);

        expect(sent).toEqual([]);
        expect(failures).toEqual([{ sheetID: "7", reason: "tooLarge" }]);
    });

    it("are reported when the room could not send them", () => {
        socketOpen = false;
        sheetActions.deleteItem("talents.list.items.t1");

        expect(failures).toEqual([{ sheetID: "7", reason: "offline" }]);
    });

    it("that wait for their debounce go before an edit sent at once, as the server must apply them", () => {
        vi.useFakeTimers();
        sheetActions.change("talents.list.items.t1.name", "Iron Wi");
        sheetActions.positionsChanged("talents.list.items", { t1: { colIndex: 0, rowIndex: 1 } });
        sheetActions.deleteItem("talents.list.items.t1");
        vi.advanceTimersByTime(200);

        expect(sent).toMatchObject([
            { type: "change", path: "talents.list.items.t1.name", sheetID: "7" },
            { type: "positionsChanged", path: "talents.list.items" },
            { type: "deleteItem", path: "talents.list.items.t1" },
        ]);
    });

    it("go signed with their own sheet, and two sheets editing the same field both send", () => {
        vi.useFakeTimers();
        const other = createSheetActions(loadState({}), "black_crusade", sheetTransport("8"));
        sheetActions.change("characterInfo.race", "Human");
        other.change("characterInfo.race", "Astartes");
        vi.advanceTimersByTime(200);

        expect(sent).toMatchObject([
            { type: "change", sheetID: "7", change: "Human" },
            { type: "change", sheetID: "8", change: "Astartes" },
        ]);
    });
});

describe("a dropped connection", () => {
    it("makes the sheet read-only and drops the edits in flight until it is back", () => {
        vi.useFakeTimers();
        sheetActions.deleteItem("talents.list.items.t1");
        sheetActions.change("characterInfo.race", "Human");
        const [inFlight] = sent;

        receive({ type: "disconnected" });
        expect(online.value).toBe(false);
        // A late answer and the debounced edit go nowhere: the sheet is read again.
        receive({ type: "response", eventID: inFlight.eventID, OK: false, code: "internal" });
        vi.advanceTimersByTime(200);
        expect(sent).toEqual([inFlight]);
        expect(failures).toEqual([]);

        receive({ type: "reconnected" });
        expect(online.value).toBe(true);
    });
});

describe("portrait requests", () => {
    // The page's token on the element the sheet renders into; network.ts reads it once.
    const box = document.createElement("div");
    box.id = "character-sheet-container";
    box.dataset.csrf = "token-1";
    document.body.append(box);

    let requests: { url: string; init: RequestInit }[];
    let answer: () => Response | Promise<Response>;
    beforeEach(() => {
        requests = [];
        answer = () => new Response(null, { status: 204 });
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
            requests.push({ url, init });
            return answer();
        }));
    });
    afterEach(() => vi.unstubAllGlobals());

    const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

    it("send the image itself to PUT /sheet/portrait/:id with the page's CSRF token", async () => {
        const image = new Blob(["webp"], { type: "image/webp" });
        await sheetActions.uploadPortrait(image);
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe("/sheet/portrait/7");
        expect(requests[0].init.method).toBe("PUT");
        expect(requests[0].init.body).toBe(image);
        expect(header(requests[0].init, "X-CSRF-Token")).toBe("token-1");
        // The socket does not carry it: the bytes go over HTTP.
        expect(sent).toEqual([]);
    });

    it("delete with DELETE /sheet/portrait/:id and no body", async () => {
        await sheetActions.deletePortrait();
        expect(requests[0].url).toBe("/sheet/portrait/7");
        expect(requests[0].init.method).toBe("DELETE");
        expect(requests[0].init.body).toBeUndefined();
        expect(header(requests[0].init, "X-CSRF-Token")).toBe("token-1");
    });

    it("reject with what to show when the server refuses", async () => {
        const image = new Blob(["png"], { type: "image/png" });
        answer = () => new Response("Bad Request", { status: 400 });
        await expect(sheetActions.uploadPortrait(image)).rejects.toThrow("Not a 360×480 WebP or JPEG image.");
        answer = () => new Response("Request Entity Too Large", { status: 413 });
        await expect(sheetActions.uploadPortrait(image)).rejects.toThrow("The image is larger than 128 KB.");
        answer = () => new Response(JSON.stringify({ code: "quota", message: "Your bestiary is over 10 MB." }), {
            status: 413, headers: { "Content-Type": "application/json" },
        });
        await expect(sheetActions.uploadPortrait(image)).rejects.toThrow("Your bestiary is over 10 MB.");
        answer = () => new Response("Forbidden", { status: 403 });
        await expect(sheetActions.deletePortrait()).rejects.toThrow("You cannot edit this sheet.");
        answer = () => { throw new TypeError("Failed to fetch"); };
        await expect(sheetActions.deletePortrait()).rejects.toThrow("There is no connection to the server.");
    });
});

describe("portraitChanged", () => {
    it("sets the portrait of the sheet it names", () => {
        const payload = (sheetId: string): SheetPayload => ({
            sheetId, kind: "black_crusade", canEdit: true, content: {} as SheetPayload["content"],
            portrait: null, version: 0, rollDefaults: {} as SheetPayload["rollDefaults"],
        });
        const mine = createSheetInstance(payload("7"));
        const other = createSheetInstance(payload("8"));
        try {
            receive({ type: "portraitChanged", eventID: "e1", sheetID: "7", portrait: "0123456789abcdef" });
            expect(mine.portrait.value).toBe("0123456789abcdef");
            expect(other.portrait.value).toBeNull();
            receive({ type: "portraitChanged", eventID: "e2", sheetID: "7", portrait: null });
            expect(mine.portrait.value).toBeNull();
        } finally {
            mine.dispose();
            other.dispose();
        }
    });
});

describe("versions of a sheet on the page", () => {
    const RACE = "characterInfo.race";
    let sheet: ReturnType<typeof createSheetInstance>;
    beforeEach(() => {
        vi.useFakeTimers();
        sheet = createSheetInstance({
            sheetId: "9", kind: "black_crusade", canEdit: true, version: 5,
            content: { characterInfo: { race: "Human" } } as unknown as SheetPayload["content"],
            portrait: null, rollDefaults: {} as SheetPayload["rollDefaults"],
        });
    });
    afterEach(() => sheet.dispose());

    const race = () => sheet.state.characterInfo.race.value;
    const remote = (change: string, version?: number) =>
        receive({ type: "change", eventID: `r${version}`, sheetID: "9", path: RACE, change, ...(version === undefined ? {} : { version }) });
    const sendRace = (value: string) => {
        sheet.actions.change(RACE, value);
        vi.advanceTimersByTime(200);
        return sent.at(-1)!;
    };

    it("drop a remote change the payload already has, and apply one without a version as it comes", () => {
        remote("Old", 5);
        expect(race()).toBe("Human");
        remote("Unversioned");
        expect(race()).toBe("Unversioned");
        remote("Newer", 6);
        expect(race()).toBe("Newer");
    });

    it("keep an own edit waiting for its debounce over a remote change of its field", () => {
        sheet.actions.change(RACE, "Mine");
        remote("Theirs", 7);
        expect(race()).toBe("Mine");
        vi.advanceTimersByTime(200);
        expect(sent).toMatchObject([{ type: "change", sheetID: "9", change: "Mine" }]);
    });

    it("hold a remote change until the own edit is answered, and apply it when it was written later", () => {
        const mine = sendRace("Mine");
        remote("Theirs", 9);
        expect(race()).toBe("Mine");
        receive({ type: "response", eventID: mine.eventID, OK: true, version: 8 });
        expect(race()).toBe("Theirs");
    });

    it("keep the own edit when it was written after the remote change", () => {
        const mine = sendRace("Mine");
        remote("Theirs", 8);
        receive({ type: "response", eventID: mine.eventID, OK: true, version: 9 });
        expect(race()).toBe("Mine");
    });

    it("drop an own edit answered gone without a notice, and apply what waited for it", () => {
        const mine = sendRace("Mine");
        remote("Theirs", 8);
        receive({ type: "response", eventID: mine.eventID, OK: false, code: "gone" });
        expect(failures).toEqual([]);
        expect(race()).toBe("Theirs");
    });

    it("take a moved item away when the move is answered gone, and report a move into a deleted item", () => {
        const moving = createSheetInstance({
            sheetId: "10", kind: "black_crusade", canEdit: true, version: 5,
            content: {
                talents: { list: { items: { t1: { name: "T" }, t2: { name: "U" } }, layouts: { t1: { colIndex: 0, rowIndex: 0 }, t2: { colIndex: 0, rowIndex: 1 } } } },
                traits: { list: { items: {}, layouts: {} } },
            } as unknown as SheetPayload["content"],
            portrait: null, rollDefaults: {} as SheetPayload["rollDefaults"],
        });
        try {
            const pos = { colIndex: 0, rowIndex: 0 };
            moving.actions.moveItemBetweenGrids("talents.list.items", "traits.list.items", "t1", pos);
            expect(readJson(moving.state, "traits.list.items.t1")).toMatchObject({ name: "T" });
            receive({ type: "response", eventID: sent.at(-1)!.eventID, OK: false, code: "gone" });
            expect(readJson(moving.state, "traits.list.items.t1")).toBe(ABSENT);
            expect(readJson(moving.state, "traits.list.layouts.t1")).toBe(ABSENT);
            expect(failures).toEqual([]);

            moving.actions.moveItemBetweenGrids("talents.list.items", "traits.list.items", "t2", pos);
            receive({ type: "response", eventID: sent.at(-1)!.eventID, OK: false, code: "destinationGone" });
            expect(failures).toEqual([{ sheetID: "10", reason: "destinationGone" }]);
        } finally {
            moving.dispose();
        }
    });

    it("apply what waited for an own edit once the connection drops", () => {
        sendRace("Mine");
        remote("Theirs", 8);
        receive({ type: "disconnected" });
        expect(race()).toBe("Theirs");
        receive({ type: "reconnected" });
    });
});
