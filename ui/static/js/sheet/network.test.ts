import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { online } from "./connection";
import { sheetTransport } from "./network";
import { createSheetActions, type SheetActions } from "./state/actions";
import { loadState } from "./components/testUtils";
import { createSheetInstance } from "./instance";
import type { SheetPayload } from "./payload";

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
            portrait: null, rollDefaults: {} as SheetPayload["rollDefaults"],
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
