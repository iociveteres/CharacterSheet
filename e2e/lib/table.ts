// The setup most scenarios share: fresh sheets in the test room and two
// players under the same user. A opens the sheet by its room URL, B opens the
// room and clicks the sheet in the list, the two ways a player gets to it.
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import type { Browser } from "playwright-core";
import { config } from "./config";
import { launch, Player } from "./player";

export interface Table {
    browser: Browser;
    a: Player;
    b: Player;
    /** The fresh sheets; A and B have the first one open. */
    sheets: number[];
    sheet: number;
    /** Another player on the first sheet, opened by URL; `auth` is the session of another user. */
    another(name?: string, auth?: string): Promise<Player>;
}

/** Creates a sheet from the room page of `p` and returns its id. */
export async function createSheet(p: Player): Promise<number> {
    const id = await p.page.evaluate(() => new Promise<number>((resolve, reject) => {
        const eventID = crypto.randomUUID();
        const timer = setTimeout(() => reject(new Error("No newCharacterItem")), 5000);
        document.addEventListener("ws:newCharacterItem", e => {
            const d = (e as CustomEvent).detail;
            if (d.eventID !== eventID) return;
            clearTimeout(timer);
            resolve(d.sheetID);
        });
        document.dispatchEvent(new CustomEvent("room:sendMessage", {
            detail: JSON.stringify({ type: "newCharacter", eventID, kind: "black_crusade" }),
        }));
    }));
    await p.page.locator(`a[href="/sheet/view/${id}"]`).first().waitFor();
    return id;
}

export async function deleteSheet(p: Player, sheet: number): Promise<void> {
    await p.page.evaluate(sheetID => new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 5000);
        document.addEventListener("ws:deleteCharacter", e => {
            if (String((e as CustomEvent).detail.sheetID) !== sheetID) return;
            clearTimeout(timer);
            resolve();
        });
        document.dispatchEvent(new CustomEvent("room:sendMessage", {
            detail: JSON.stringify({ type: "deleteCharacter", eventID: crypto.randomUUID(), sheetID }),
        }));
    }), String(sheet));
}

/** Sets who else in the room sees and edits the sheet, e.g. "everyone_can_view". */
export async function setVisibility(p: Player, sheet: number, visibility: string): Promise<void> {
    await p.page.evaluate(([sheetID, visibility]) => {
        document.dispatchEvent(new CustomEvent("room:sendMessage", {
            detail: JSON.stringify({ type: "changeSheetVisibility", eventID: crypto.randomUUID(), sheetID, visibility }),
        }));
    }, [String(sheet), visibility]);
    await p.waitReceived(m => m.type === "changeSheetVisibility" && String(m.sheetID) === String(sheet), "the visibility change");
}

/** Fails the test on errors and warnings of the players' pages. */
export function expectNoErrors(players: Player[]): void {
    const errors = players.flatMap(p => p.takeErrors().map(e => `${p.name}: ${e}`));
    expect(errors, "console errors and warnings").toEqual([]);
}

/**
 * Registers the hooks of a scenario file: `count` fresh sheets named after the
 * scenario, A and B on the first one, errors checked after every test, the
 * sheets deleted at the end.
 */
export function useTable(scenario: string, { count = 1 } = {}): Table {
    const table = {} as Table;
    const extra: Player[] = [];

    beforeAll(async () => {
        table.browser = await launch();
        table.a = await Player.create(table.browser, "A");
        table.b = await Player.create(table.browser, "B");
        await table.b.openRoom(config.room);
        table.sheets = [];
        for (let i = 0; i < count; i++) table.sheets.push(await createSheet(table.b));
        table.sheet = table.sheets[0];
        await table.b.switchTo(table.sheet);
        await table.a.openSheet(config.room, table.sheet);
        // The name tells leftovers of a failed run apart.
        await table.a.write("characterInfo.characterName", `e2e ${scenario}`);
        await table.b.expectValue("characterInfo.characterName", `e2e ${scenario}`);
        table.another = async (name = "C", auth = config.auth) => {
            const p = await Player.create(table.browser, name, { auth });
            extra.push(p);
            await p.openSheet(config.room, table.sheet);
            return p;
        };
    });

    afterEach(() => expectNoErrors([table.a, table.b, ...extra].filter(Boolean)));

    afterAll(async () => {
        if (!table.browser) return;
        try {
            if (table.b && table.sheets) {
                await table.b.openRoom(config.room);
                for (const sheet of table.sheets) await deleteSheet(table.b, sheet);
            }
        } finally {
            await table.browser.close();
        }
    });

    return table;
}
