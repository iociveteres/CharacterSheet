// Scenario 19: a dropped connection. A's room socket goes through a gate
// (Player.gateSockets) that lets reconnects through, holds or refuses them;
// the drop itself is a close of the socket from the page, so room/socket.js
// goes through its own close, retry and reopen against the server.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Player, SocketGate } from "../lib/player";
import { addItem, addTab, grid, openTab, selectTab, showGrid, tabIds } from "../lib/sheet";
import { useTable } from "../lib/table";
import { eventually, sleep } from "../lib/wait";

const LOST = "Connection lost: the sheet is read-only until it is back.";
const RESTORED = "Connection restored.";
const TOO_LARGE = "Your change was not saved: it is larger than 32 KB.";
/** What room/socket.js logs itself while the connection is down. */
const SOCKET_LOGS = [/^error: WebSocket error/, /WebSocket not connected, cannot send message/, /Max reconnection attempts reached/];
const CONTROLS = [".add-button", ".add-tab-btn", ".drag-handle", ".delete-button", "#toggle-delete-mode"];

/** Paths of the fields that are neither read-only nor disabled. */
function editableFields(p: Player): Promise<string[]> {
    return p.page.evaluate(() => Array.from(window.__e2e.root().querySelectorAll("input[data-id], select[data-id], textarea[data-id]"))
        .filter(el => !(el as HTMLInputElement).readOnly && !(el as HTMLInputElement).disabled)
        .map(el => window.__e2e.pathOf(el)));
}

async function controlCounts(p: Player): Promise<{ [sel: string]: number }> {
    const out: { [sel: string]: number } = {};
    for (const sel of CONTROLS) out[sel] = await p.count({ sel });
    return out;
}

const socketCount = (p: Player) => p.page.evaluate(() => window.__e2e.sockets.length);
const socketOpen = (p: Player) => p.page.evaluate(() => window.__e2e.socketOpen());
const inserted = (p: Player) => p.page.evaluate(() => window.__e2e.inserted);

/** Waits until the sheet on A's page was read again after `before` inserts. */
async function reread(p: Player, before: number, timeout = 10_000): Promise<void> {
    await eventually(() => inserted(p), n => expect(n, `${p.name}: the sheet is read again`).toBeGreaterThan(before), timeout);
}

describe("19. connection", () => {
    const t = useTable("19 connection");
    let gate: SocketGate;

    beforeAll(async () => {
        t.a.allowErrors(...SOCKET_LOGS);
        gate = await t.a.gateSockets();
    });

    // A test that gave up on the connection leaves A without one.
    beforeEach(async () => {
        gate.set("pass");
        if (!(await socketOpen(t.a))) await t.a.reload();
        await t.a.clearRecords();
        await t.b.clearRecords();
    });

    it("while the socket is down the sheet is read-only; once it is back A shows what B changed meanwhile and keeps its UI state", async () => {
        const { a, b } = t;
        await a.openNavTab("psykana");
        const tabs = "psykana.tabs.items";
        await addTab(a, tabs);
        await addTab(a, tabs);
        const second = (await tabIds(a, tabs))[1];
        await selectTab(a, tabs, second);
        const talent = await addItem(a, await showGrid(a, grid("talents")));
        await b.expectValue(`${talent}.name`, "");
        const collapsed = !(await a.isCollapsed(talent));
        await a.setCollapsed(talent, collapsed);
        const before = await controlCounts(a);
        for (const sel of [".add-button", ".drag-handle", "#toggle-delete-mode"]) expect(before[sel], sel).toBeGreaterThan(0);
        const race = `race ${Date.now()}`;
        const oldRace = await a.read("characterInfo.race");
        await a.clearRecords();

        gate.set("hold");
        await a.dropSocket();
        await a.expectNotice(LOST);
        await eventually(() => editableFields(a), f => expect(f, "editable fields while offline").toEqual([]));
        expect(await controlCounts(a)).toEqual(Object.fromEntries(CONTROLS.map(sel => [sel, 0])));

        await b.write("characterInfo.race", race);
        const change = await b.waitSent(m => m.type === "change" && m.path === "characterInfo.race", "the race");
        await b.waitReceived(m => m.type === "response" && m.eventID === change.eventID && m.OK, "the answer to the race");
        expect(await a.read("characterInfo.race"), "A is offline").toBe(oldRace);

        const n = await inserted(a);
        gate.set("pass");
        await a.expectNotice(RESTORED, 10_000);
        await reread(a, n);
        await a.expectValue("characterInfo.race", race);
        expect(await controlCounts(a)).toEqual(before);
        expect(await editableFields(a)).not.toEqual([]);
        expect(await a.isCollapsed(talent), "the talent's collapsed state").toBe(collapsed);
        expect(await openTab(a, tabs), "the open psykana tab").toBe(second);
    });

    it("the open navigation tab stays after the re-read", async () => {
        const { a } = t;
        await a.openNavTab("gear");
        const n = await inserted(a);
        await a.dropSocket();
        await a.expectNotice(RESTORED, 10_000);
        await reread(a, n);
        expect(await a.page.evaluate(() => (window.__e2e.root().getElementById("show-gear") as HTMLInputElement).checked), "the open navigation tab").toBe(true);
    });

    it("an edit still in its debounce when the socket drops is not sent, and A shows the server's value once back", async () => {
        const { a, b } = t;
        await a.openNavTab("player");
        const stored = `stored ${Date.now()}`;
        await a.write("characterInfo.race", stored);
        await b.expectValue("characterInfo.race", stored);
        await a.clearRecords();
        await b.clearRecords();

        const n = await inserted(a);
        const unsent = `unsent ${Date.now()}`;
        // In one evaluate, so the socket closes well within the 200 ms debounce.
        await a.page.evaluate(v => {
            window.__e2e.write("characterInfo.race", v);
            window.__e2e.sockets.findLast(s => s.readyState === WebSocket.OPEN)!.close();
        }, unsent);
        await a.expectNotice(LOST);
        await a.expectNotice(RESTORED, 10_000);
        await reread(a, n);
        await a.expectValue("characterInfo.race", stored);

        await sleep(500);
        expect((await a.sent()).filter(m => m.path === "characterInfo.race"), "A sent the edit").toEqual([]);
        expect((await b.received()).filter(m => m.path === "characterInfo.race"), "B got the edit").toEqual([]);
        expect(await b.read("characterInfo.race")).toBe(stored);
        expect((await a.sheetState()).content.characterInfo.race).toBe(stored);
    });

    it("an edit over 32 KB is not sent: A is told, the field goes back to the stored value and the socket stays open", async () => {
        const { a, b } = t;
        const note = await addItem(a, await showGrid(a, grid("notes")));
        const path = `${note}.description`;
        await a.write(path, "stored description");
        await b.expectValue(path, "stored description");
        await a.clearRecords();
        const sockets = await socketCount(a);

        const n = await inserted(a);
        await a.write(path, "x".repeat(40 * 1024));
        await a.expectNotice(TOO_LARGE);
        await reread(a, n);
        await a.expectValue(path, "stored description");
        expect((await a.settledSheetMessages()).filter(m => m.path === path), "A sent the edit").toEqual([]);

        expect(await socketOpen(a), "A's socket is open").toBe(true);
        expect(await socketCount(a), "A did not reconnect").toBe(sockets);
        expect(await a.page.evaluate(() => window.__e2e.notices), "no other notice").toEqual([TOO_LARGE]);
        await a.write(path, "small after");
        await b.expectValue(path, "small after");
    });

    it("an edit between 4 KB and 32 KB is saved and reaches B", async () => {
        const { a, b } = t;
        const note = await addItem(a, await showGrid(a, grid("notes")));
        const path = `${note}.description`;
        await a.clearRecords();
        const sockets = await socketCount(a);
        // Two bytes a letter in UTF-8: about 10 KB.
        const text = "Длинное описание заметки. ".repeat(200);
        expect(new TextEncoder().encode(text).length).toBeGreaterThan(8 * 1024);

        await a.write(path, text);
        const change = await a.waitSent(m => m.type === "change" && m.path === path, "the description");
        await a.waitReceived(m => m.type === "response" && m.eventID === change.eventID, "the answer");
        expect((await a.received("response")).find(m => m.eventID === change.eventID)?.OK, "the server took it").toBe(true);
        await b.expectValue(path, text);
        expect(await socketCount(a), "A did not reconnect").toBe(sockets);
        expect(await a.page.evaluate(() => window.__e2e.notices)).toEqual([]);
        const [, , , id] = note.split(".");
        expect((await a.sheetState()).content.notes.list.items[id].description).toBe(text);
    });

    it("after three refused retries (2, 4 and 6 s) the room shows the connection-lost modal and stops trying", async () => {
        const { a } = t;
        const modal = a.page.locator("#connection-lost-modal");
        expect(await modal.isVisible()).toBe(false);
        const attempts = gate.attempts;

        gate.set("refuse");
        const start = Date.now();
        await a.dropSocket();
        await a.expectNotice(LOST);
        await modal.waitFor({ state: "visible", timeout: 20_000 });
        const took = Date.now() - start;
        expect(gate.attempts - attempts, "retries").toBe(3);
        expect(took, "the retries wait 2 + 4 + 6 s").toBeGreaterThan(11_000);

        await sleep(7000);
        expect(gate.attempts - attempts, "no retry after giving up").toBe(3);
        expect(await modal.isVisible()).toBe(true);
        expect(await editableFields(a), "the sheet stays read-only").toEqual([]);
        expect(await a.page.evaluate(() => window.__e2e.notices)).toEqual([LOST]);
    });
});
