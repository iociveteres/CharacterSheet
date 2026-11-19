// What a player is told of a dropped connection, without its wording: a
// notice when it is lost, another when it is back, and the sheet read again
// with what changed meanwhile. connection.e2e.ts covers the rest of the
// offline sheet; A's socket goes through the same gate (Player.gateSockets).
import { beforeAll, describe, expect, it } from "vitest";
import type { SocketGate } from "../../lib/player";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

const RACE = "characterInfo.race";
/** What room/socket.js logs itself while the connection is down. */
const SOCKET_LOGS = [/^error: WebSocket error/, /WebSocket not connected, cannot send message/];

describe("connection notices", () => {
    const t = useTable("connection notices");
    let gate: SocketGate;

    beforeAll(async () => {
        t.a.allowErrors(...SOCKET_LOGS);
        gate = await t.a.gateSockets();
        await t.a.openNavTab("player");
        await t.b.openNavTab("player");
    });

    it("a lost connection and its return each show a notice, and the sheet is read again", async () => {
        const { a, b } = t;
        await a.clearRecords();

        gate.set("hold");
        await a.dropSocket();
        const [lost] = await a.waitNotices(1);
        await eventually(() => a.attr(RACE, "readonly"), ro => expect(ro, "A's field while offline").not.toBeNull());

        const race = `race ${Date.now()}`;
        await b.write(RACE, race);
        const change = await b.waitSent(m => m.type === "change" && m.path === RACE, "the race");
        await b.waitReceived(m => m.type === "response" && m.eventID === change.eventID && m.OK, "the answer to the race");
        const inserted = await a.page.evaluate(() => window.__e2e.inserted);

        gate.set("pass");
        const [, restored] = await a.waitNotices(2, 10_000);
        expect(restored, "the notice of the return is not the one of the loss").not.toBe(lost);
        await eventually(() => a.page.evaluate(() => window.__e2e.inserted), n => expect(n, "A's sheet is read again").toBeGreaterThan(inserted), 10_000);
        await a.expectValue(RACE, race);
        expect(await a.attr(RACE, "readonly"), "A's field once back").toBeNull();
    });
});
