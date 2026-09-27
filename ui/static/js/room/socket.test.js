import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { listenRemote } from "./remote";
import { modals, sheets } from "./state";

class FakeSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeSocket.OPEN;
    sent = [];
    send(data) {
        this.sent.push(data);
    }
}

let socket;

const receive = data => socket.dispatchEvent(Object.assign(new Event("message"), { data }));
const sendMessage = detail =>
    document.dispatchEvent(new CustomEvent("room:sendMessage", { detail, cancelable: true }));

function record(types) {
    const events = [];
    const listener = e => events.push([e.type, e.detail]);
    types.forEach(type => document.addEventListener(type, listener));
    afterEach(() => types.forEach(type => document.removeEventListener(type, listener)));
    return events;
}

// socket.js connects on import, to the room of the page.
beforeAll(async () => {
    document.body.innerHTML = `<div id="room" data-room-id="5"></div>`;
    vi.stubGlobal("WebSocket", class extends FakeSocket {
        constructor() {
            super();
            socket = this;
        }
    });
    await import("./socket.js");
    listenRemote();
});

afterEach(() => vi.useRealTimers());

describe("the room's socket", () => {
    const events = record(["ws:change", "ws:chatMessage"]);

    it("hands on each message of the server as a ws:<type> event", () => {
        receive('{"type":"change","path":"a","change":1}\n{"type":"chatMessage","messageBody":"hi"}\n');

        expect(events).toEqual([
            ["ws:change", { type: "change", path: "a", change: 1 }],
            ["ws:chatMessage", { type: "chatMessage", messageBody: "hi" }],
        ]);
    });

    it("sends room:sendMessage, and cancels it while it is not open", () => {
        socket.sent = [];
        expect(sendMessage('{"type":"chatHistory"}')).toBe(true);
        socket.readyState = FakeSocket.CONNECTING;
        try {
            expect(sendMessage('{"type":"chatMessage"}')).toBe(false);
        } finally {
            socket.readyState = FakeSocket.OPEN;
        }

        expect(socket.sent).toEqual(['{"type":"chatHistory"}']);
    });
});

describe("a dropped connection", () => {
    const events = record(["ws:disconnected", "ws:reconnected"]);

    it("is announced once, retried after 2 s, and announced again when it is back", () => {
        vi.useFakeTimers();
        const dropped = socket;
        dropped.readyState = FakeSocket.CLOSED;
        dropped.dispatchEvent(new Event("close"));

        vi.advanceTimersByTime(2000);
        expect(socket).not.toBe(dropped);
        socket.readyState = FakeSocket.CLOSED;
        socket.dispatchEvent(new Event("close"));

        vi.advanceTimersByTime(4000);
        socket.dispatchEvent(new Event("open"));

        expect(events.map(([type]) => type)).toEqual(["ws:disconnected", "ws:reconnected"]);
    });

    it("gives up after three retries and asks for a page refresh", () => {
        vi.useFakeTimers();
        const drop = () => {
            socket.readyState = FakeSocket.CLOSED;
            socket.dispatchEvent(new Event("close"));
        };

        // The retries wait 2, 4 and 6 s.
        drop();
        for (const wait of [2000, 4000]) {
            vi.advanceTimersByTime(wait);
            drop();
        }
        expect(modals.value.connectionLost).toBe(false);
        vi.advanceTimersByTime(6000);
        drop();

        expect(modals.value.connectionLost).toBe(true);
        const retries = socket;
        vi.advanceTimersByTime(60000);
        expect(socket).toBe(retries);
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
