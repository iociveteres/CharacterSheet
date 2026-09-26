import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { networkHandlers } from "../room/network.js";
import { setCurrentSheetId } from "./current";
import type { SheetActions } from "./state/actions";

class FakeSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = FakeSocket.CONNECTING;
    sent: { eventID: string; type: string }[] = [];
    send(json: string): void {
        this.sent.push(JSON.parse(json));
    }
}

let socket: FakeSocket;
let sheetActions: SheetActions;

function receive(msg: object): void {
    socket.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(msg) }));
}

// network.js connects on import, to the room of the page.
beforeAll(async () => {
    document.body.innerHTML = `<div id="room" data-room-id="5"></div>`;
    vi.stubGlobal("WebSocket", class extends FakeSocket {
        constructor() {
            super();
            socket = this;
        }
    });
    ({ sheetActions } = await import("./network.js"));
});

describe("messages of sheets that are not open", () => {
    it("rename the sheet in the room list", () => {
        const room = Object.assign(Object.create(networkHandlers), {
            allPlayers: [{ sheets: [{ id: 7, name: "Kharn" }, { id: 8, name: "Other" }] }],
        });
        room.setupNetworkListeners();

        receive({ type: "change", sheetID: "8", path: "characterInfo.characterName", change: "Lorgar" });
        receive({ type: "change", sheetID: "7", path: "characterInfo.race", change: "Human" });

        expect(room.allPlayers[0].sheets.map((s: { name: string }) => s.name)).toEqual(["Kharn", "Lorgar"]);
    });
});

describe("edits of the sheet", () => {
    let failures: unknown[];
    const record = (e: Event) => failures.push((e as CustomEvent).detail);

    beforeEach(() => {
        failures = [];
        socket.sent = [];
        setCurrentSheetId("7");
        document.addEventListener("sheet:editFailed", record);
    });

    afterEach(() => {
        document.removeEventListener("sheet:editFailed", record);
        vi.useRealTimers();
    });

    it("are reported when the server rejects them, not when it accepts them", () => {
        sheetActions.deleteItem("talents.list.items.t1");
        sheetActions.deleteItem("talents.list.items.t2");
        const [accepted, rejected] = socket.sent;

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

        expect(socket.sent).toEqual([]);
        expect(failures).toEqual([{ sheetID: "7", reason: "tooLarge" }]);
    });

    it("belong to the sheet they were made on, when another opens before a debounced edit goes", () => {
        vi.useFakeTimers();
        sheetActions.change("characterInfo.race", "Human");
        setCurrentSheetId("8");
        vi.advanceTimersByTime(200);

        expect(socket.sent).toMatchObject([{ type: "change", sheetID: "7" }]);
    });
});
