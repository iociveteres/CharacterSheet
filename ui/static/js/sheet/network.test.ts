import { beforeAll, describe, expect, it, vi } from "vitest";
import { networkHandlers } from "../room/network.js";

class FakeSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = FakeSocket.CONNECTING;
    send(): void { }
}

let socket: FakeSocket;

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
    await import("./network.js");
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
