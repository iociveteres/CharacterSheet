// The checks of the watch bundle stay silent on real sheets. The
// other scenarios fail on any warning, so on a dev build they cover their own
// sheets; this one opens the filled sheets read-only. Runs only against a
// server with -dev and the `npm run watch` bundle.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { config } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";

const DEV_WARNINGS = [/normalizeSheet: dropped layouts of missing items/];

async function isDevBundle(): Promise<boolean> {
    try {
        const js = await (await fetch(`${config.base}/static/dist/sheet.js`)).text();
        return js.includes("normalizeSheet: dropped layouts of missing items");
    } catch {
        return false;
    }
}

const ROOMS: [number, number[]][] = [[config.fullRoom, config.fullSheets]];

describe.skipIf(!(await isDevBundle()))("dev checks stay silent", () => {
    let browser: Browser;
    let p: Player;

    beforeAll(async () => {
        browser = await launch();
        p = await Player.create(browser, "Reader");
    });

    afterAll(async () => {
        await browser?.close();
    });

    for (const [room, sheets] of ROOMS) {
        for (const sheet of sheets) {
            it(`sheet ${sheet} opened by its URL`, async () => {
                await p.openSheet(room, sheet);
                await p.page.waitForTimeout(500);
                const errors = p.takeErrors();
                expect(errors.filter(e => DEV_WARNINGS.some(re => re.test(e))), "dev warnings").toEqual([]);
                expect(errors).toEqual([]);
            });
        }

        it(`sheets of room ${room} switched in the room list`, async () => {
            await p.openRoom(room);
            for (const sheet of [...sheets, ...sheets]) {
                await p.switchTo(sheet);
                await p.page.waitForTimeout(300);
            }
            expectNoErrors([p]);
        });
    }
});
