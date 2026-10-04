import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectSocket } from "./socket";

class FakeSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeSocket.OPEN;
    sent: string[] = [];
    constructor(public url: string) {
        super();
    }
    send(data: string) {
        this.sent.push(data);
    }
}

let socket: FakeSocket;

const receive = (data: string) => socket.dispatchEvent(Object.assign(new Event("message"), { data }));
const sendMessage = (detail: string) =>
    document.dispatchEvent(new CustomEvent("room:sendMessage", { detail, cancelable: true }));

/** The events of `types` each test of the describe block gets. */
function record(types: string[], target: EventTarget = document) {
    const events: [string, unknown][] = [];
    const listener = (e: Event) => events.push([e.type, (e as CustomEvent).detail]);
    beforeEach(() => {
        events.length = 0;
        types.forEach(type => target.addEventListener(type, listener));
    });
    afterEach(() => types.forEach(type => target.removeEventListener(type, listener)));
    return events;
}

beforeAll(() => {
    vi.stubGlobal("WebSocket", class extends FakeSocket {
        constructor(url: string) {
            super(url);
            socket = this;
        }
    });
    connectSocket("/bestiary/ws");
});

afterEach(() => vi.useRealTimers());

describe("a page's socket", () => {
    const events = record(["ws:change", "ws:rollResult"]);

    it("connects to its path on this host", () => {
        expect(socket.url).toBe(`ws://${location.host}/bestiary/ws`);
    });

    it("hands on each message of the server as a ws:<type> event", () => {
        receive('{"type":"change","path":"a","change":1}\n{"type":"rollResult","messageBody":"/r d10"}\n');

        expect(events).toEqual([
            ["ws:change", { type: "change", path: "a", change: 1 }],
            ["ws:rollResult", { type: "rollResult", messageBody: "/r d10" }],
        ]);
    });

    it("sends room:sendMessage, and cancels it while it is not open", () => {
        socket.sent = [];
        expect(sendMessage('{"type":"roll"}')).toBe(true);
        socket.readyState = FakeSocket.CONNECTING;
        try {
            expect(sendMessage('{"type":"change"}')).toBe(false);
        } finally {
            socket.readyState = FakeSocket.OPEN;
        }

        expect(socket.sent).toEqual(['{"type":"roll"}']);
    });
});

describe("a dropped connection", () => {
    const events = record(["ws:disconnected", "ws:reconnected"]);
    const lost = record(["ws:connectionLost"], window);

    it("is announced once, retried after 2 s, and announced again when it is back", () => {
        vi.useFakeTimers();
        const dropped = socket;
        dropped.readyState = FakeSocket.CLOSED;
        dropped.dispatchEvent(new Event("close"));

        vi.advanceTimersByTime(2000);
        expect(socket).not.toBe(dropped);
        expect(socket.url).toBe(dropped.url);
        socket.readyState = FakeSocket.CLOSED;
        socket.dispatchEvent(new Event("close"));

        vi.advanceTimersByTime(4000);
        socket.dispatchEvent(new Event("open"));

        expect(events.map(([type]) => type)).toEqual(["ws:disconnected", "ws:reconnected"]);
    });

    it("gives up after three retries and says so on window", () => {
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
        expect(lost).toEqual([]);
        vi.advanceTimersByTime(6000);
        drop();

        expect(lost.map(([type]) => type)).toEqual(["ws:connectionLost"]);
        const retries = socket;
        vi.advanceTimersByTime(60000);
        expect(socket).toBe(retries);
    });
});
