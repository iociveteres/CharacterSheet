import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { online } from "./connection";
import { sheetTransport } from "./network";
import { createSheetActions, type SheetActions } from "./state/actions";
import { loadState } from "./components/testUtils";

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
    sheetActions = createSheetActions(loadState({}), sheetTransport("7"));
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
        const other = createSheetActions(loadState({}), sheetTransport("8"));
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
