import { beforeAll, describe, expect, it, vi } from "vitest";
import { listenRemote } from "./remote";
import { modals, sheets } from "./state";

// How the socket reconnects is tested with ../socket.ts; here, what the room
// does with it.
class FakeSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeSocket.OPEN;
    constructor(url) {
        super();
        this.url = url;
    }
    send() {}
}

let socket;

const receive = data => socket.dispatchEvent(Object.assign(new Event("message"), { data }));

// socket.js connects on import, to the room of the page.
beforeAll(async () => {
    document.body.innerHTML = `<div id="room" data-room-id="5"></div>`;
    vi.stubGlobal("WebSocket", class extends FakeSocket {
        constructor(url) {
            super(url);
            socket = this;
        }
    });
    await import("./socket.js");
    listenRemote();
});

describe("the room's socket", () => {
    it("connects to the room of the page", () => {
        expect(socket.url).toBe(`ws://${location.host}/room/ws/5`);
    });

    it("asks for a page refresh once it gives up", () => {
        window.dispatchEvent(new CustomEvent("ws:connectionLost"));
        expect(modals.value.connectionLost).toBe(true);
    });
});

describe("the room list", () => {
    it("renames a sheet another player renames, open or not", () => {
        const sheet = (id, name) => ({ id, ownerId: 2, name, kind: "black_crusade", visibility: "everyone_can_view", folderId: null, createdAt: "", updatedAt: "" });
        sheets.value = [sheet(7, "Kharn"), sheet(8, "Other")];

        receive(JSON.stringify({ type: "change", sheetID: "8", path: "characterInfo.characterName", change: "Lorgar" }));
        receive(JSON.stringify({ type: "change", sheetID: "7", path: "characterInfo.race", change: "Human" }));

        expect(sheets.value.map(s => s.name)).toEqual(["Kharn", "Lorgar"]);
    });
});
