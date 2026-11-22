import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
    close() {
        this.readyState = FakeSocket.CLOSED;
        this.dispatchEvent(new Event("close"));
    }
}

/** Every socket made, the latest last. */
const sockets: FakeSocket[] = [];
const socket = () => sockets[sockets.length - 1];

const receive = (data: string) => socket().dispatchEvent(Object.assign(new Event("message"), { data }));
const sendMessage = (detail: string) =>
    document.dispatchEvent(new CustomEvent("room:sendMessage", { detail, cancelable: true }));
/**
 * The latest socket closes: a drop when it was open, a failed attempt when it
 * never opened. The check URL, when asked, has answered on return.
 */
async function drop(): Promise<void> {
    socket().readyState = FakeSocket.CLOSED;
    socket().dispatchEvent(new Event("close"));
    // The check goes through a few awaits before it waits for the retry.
    for (let i = 0; i < 10; i++) await Promise.resolve();
}
const open = () => socket().dispatchEvent(new Event("open"));

/** What the check URL answers: a response, or a network error. */
let checkAnswer: () => Promise<Partial<Response>>;
const ok = () => Promise.resolve({ type: "basic", status: 200 } as Partial<Response>);
const fetchMock = vi.fn((_url: string, _init?: RequestInit) => checkAnswer());

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
            sockets.push(this);
        }
    });
    vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => vi.unstubAllGlobals());

/** The listeners of the test's connectSocket: a page has one, so each test takes its away. */
const listeners: [EventTarget, string, EventListenerOrEventListenerObject][] = [];

// Each test has an open socket of its own.
beforeEach(() => {
    checkAnswer = ok;
    fetchMock.mockClear();
    vi.useFakeTimers();
    for (const target of [document, window]) {
        const add = target.addEventListener.bind(target);
        vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
            if (listener) listeners.push([target, type, listener]);
            add(type, listener, options);
        });
    }
    connectSocket("/bestiary/ws", "/bestiary/collections");
    vi.restoreAllMocks();
    open();
    // No spread: a wait is exactly its base.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
    document.dispatchEvent(new CustomEvent("room:closeSocket"));
    for (const [target, type, listener] of listeners.splice(0)) target.removeEventListener(type, listener);
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("a page's socket", () => {
    const events = record(["ws:change", "ws:rollResult"]);

    it("connects to its path on this host", () => {
        expect(socket().url).toBe(`ws://${location.host}/bestiary/ws`);
    });

    it("hands on each message of the server as a ws:<type> event", () => {
        receive('{"type":"change","path":"a","change":1}\n{"type":"rollResult","messageBody":"/r d10"}\n');

        expect(events).toEqual([
            ["ws:change", { type: "change", path: "a", change: 1 }],
            ["ws:rollResult", { type: "rollResult", messageBody: "/r d10" }],
        ]);
    });

    it("sends room:sendMessage, and cancels it while it is not open", () => {
        expect(sendMessage('{"type":"roll"}')).toBe(true);
        socket().readyState = FakeSocket.CONNECTING;
        expect(sendMessage('{"type":"change"}')).toBe(false);

        expect(socket().sent).toEqual(['{"type":"roll"}']);
    });
});

describe("a dropped connection", () => {
    const events = record(["ws:disconnected", "ws:reconnected"]);
    const lost = record(["ws:connectionLost"], window);

    /** Lets `ms` pass and tells whether a new socket was made meanwhile. */
    async function attemptAfter(ms: number): Promise<boolean> {
        const before = sockets.length;
        await vi.advanceTimersByTimeAsync(ms);
        return sockets.length > before;
    }

    it("is announced once, retried after 1 s, and announced again when it is back", async () => {
        const dropped = socket();
        await drop();

        expect(await attemptAfter(1000)).toBe(true);
        expect(socket().url).toBe(dropped.url);
        await drop();
        expect(await attemptAfter(2000)).toBe(true);
        open();

        expect(events.map(([type]) => type)).toEqual(["ws:disconnected", "ws:reconnected"]);
    });

    it("never gives up: the waits double up to 30 s, and the tenth retry still reconnects", async () => {
        await drop();
        const waits = [1, 2, 4, 8, 16, 30, 30, 30, 30, 30];
        for (const [i, wait] of waits.entries()) {
            expect(await attemptAfter(wait * 1000 - 1), `no retry ${i + 1} before ${wait} s`).toBe(false);
            expect(await attemptAfter(1), `retry ${i + 1} after ${wait} s`).toBe(true);
            if (i < waits.length - 1) await drop();
        }
        open();

        // The room catches up on ws:reconnected (room/remote.ts).
        expect(events.map(([type]) => type)).toEqual(["ws:disconnected", "ws:reconnected"]);
        expect(lost).toEqual([]);
        // After the 3rd, 6th and 9th failure in a row.
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("waits at most 30 s, its spread included", async () => {
        vi.mocked(Math.random).mockReturnValue(0.999);
        await drop();
        for (let i = 0; i < 8; i++) {
            expect(await attemptAfter(30_000), `retry ${i + 1}`).toBe(true);
            await drop();
        }
    });

    it("spreads the waits by up to a fifth either way", async () => {
        vi.mocked(Math.random).mockReturnValue(0);
        await drop();
        expect(await attemptAfter(800)).toBe(true);
        vi.mocked(Math.random).mockReturnValue(0.999);
        await drop();
        expect(await attemptAfter(2000)).toBe(false);
        expect(await attemptAfter(400)).toBe(true);
    });

    it("is retried at once when the network comes back, and the waits start over", async () => {
        await drop();
        for (const wait of [1, 2, 4]) {
            await attemptAfter(wait * 1000);
            await drop();
        }
        // The next wait is 8 s.
        await vi.advanceTimersByTimeAsync(0);
        const waiting = sockets.length;

        window.dispatchEvent(new Event("online"));
        expect(sockets.length).toBe(waiting + 1);
        await drop();
        expect(await attemptAfter(2000), "one failure in a row, not four").toBe(true);
    });

    it("is retried at once when the tab is shown again", async () => {
        await drop();
        const waiting = sockets.length;

        document.dispatchEvent(new Event("visibilitychange"));

        expect(document.visibilityState).toBe("visible");
        expect(sockets.length).toBe(waiting + 1);
    });

    it("is not opened twice by the network coming back while it is connected", () => {
        const count = sockets.length;
        window.dispatchEvent(new Event("online"));
        expect(sockets.length).toBe(count);
    });

    it("asks the check URL after every third failure in a row and goes on while it answers 200", async () => {
        await drop();
        for (const wait of [1, 2]) {
            await attemptAfter(wait * 1000);
            await drop();
        }
        expect(fetchMock).not.toHaveBeenCalled();
        await attemptAfter(4000);
        await drop();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("/bestiary/collections");
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
        expect(await attemptAfter(8000)).toBe(true);
        expect(lost).toEqual([]);
    });

    it("goes on when the check fails for the network", async () => {
        checkAnswer = () => Promise.reject(new TypeError("Failed to fetch"));
        await drop();
        for (const wait of [1, 2, 4]) {
            await attemptAfter(wait * 1000);
            await drop();
        }

        expect(await attemptAfter(8000)).toBe(true);
        expect(lost).toEqual([]);
    });

    for (const [answer, response, reason] of [
        ["404", { type: "basic", status: 404 }, "noAccess"],
        ["403", { type: "basic", status: 403 }, "noAccess"],
        ["a redirect to the login", { type: "opaqueredirect", status: 0 }, "signedOut"],
    ] as const) {
        it(`stops when the check URL answers ${answer} and says why on window`, async () => {
            checkAnswer = () => Promise.resolve(response);
            await drop();
            for (const wait of [1, 2, 4]) {
                await attemptAfter(wait * 1000);
                await drop();
            }

            expect(lost).toEqual([["ws:connectionLost", { reason }]]);
            expect(await attemptAfter(60_000)).toBe(false);
            window.dispatchEvent(new Event("online"));
            expect(await attemptAfter(0), "no retry when the network comes back").toBe(false);
        });
    }
});

describe("a socket the page closes", () => {
    const events = record(["ws:disconnected", "ws:reconnected"]);
    const lost = record(["ws:connectionLost"], window);

    it("stays closed and tells nothing of a drop", () => {
        const closed = socket();
        document.dispatchEvent(new CustomEvent("room:closeSocket"));

        expect(closed.readyState).toBe(FakeSocket.CLOSED);
        vi.advanceTimersByTime(60000);
        window.dispatchEvent(new Event("online"));
        expect(socket()).toBe(closed);
        expect(sendMessage('{"type":"roll"}')).toBe(false);
        expect([...events, ...lost]).toEqual([]);
    });
});
