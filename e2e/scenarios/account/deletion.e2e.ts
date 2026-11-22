// The account of a player: the export of their data downloads as a ZIP that
// holds their sheet, then they delete the account by the link of the email
// and, once it is wiped, the gm in the room sees them leave the list and their
// sheet with its folder become the gm's without a reload. Needs web-dev: the
// wipe runs at once through POST /dev/account-jobs/run, a route of -dev only.
// Runs on the seeded room, whose leaver it wipes: `npm run seed` again after it.
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator } from "playwright-core";
import { config, seed, seedUser } from "../../lib/config";
import { follow } from "../../lib/forum";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import { unzip } from "../../lib/zip";

describe("deleting an account", () => {
    let browser: Browser;
    let leaver: Player;
    let gm: Player;
    const user = () => seedUser("leaver");

    const block = (p: Player, userId: number): Locator => p.page.locator(`#characters .player[data-user-id="${userId}"]`);
    const sheetIn = (scope: Locator): Locator => scope.locator(`.character-sheet-entry[data-sheet-id="${user().sheetId}"]`);
    const folderIn = (scope: Locator): Locator => scope.locator(`.folder[data-folder-id="${seed().account.leaverFolder}"]`);

    beforeAll(async () => {
        browser = await launch();
        leaver = await Player.create(browser, "leaver", { role: "leaver" });
        gm = await Player.create(browser, "gm", { role: "gm" });
    });

    afterAll(async () => {
        await browser?.close();
    });

    it("prepares the export from the account page and downloads a ZIP with the player's sheet", async () => {
        const page = leaver.page;
        await page.goto(`${config.base}/`);
        await follow(page, page.locator("nav a[href='/account/view']"));
        await follow(page, page.locator(".account-export a.button"));
        const section = page.locator("section.account-export");
        expect(await section.getAttribute("data-state")).toBe("");

        await follow(page, section.locator("form input[type=submit]"));
        // The queued page reloads itself every few seconds until the archive is built.
        await page.locator('section.account-export[data-state="ready"]').waitFor({ timeout: 30_000 });

        const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.locator("section.account-export a.button[href='/account/export/download']").click(),
        ]);
        const files = unzip(await readFile(await download.path()));
        const sheets = [...files.keys()].filter(name => new RegExp(`^sheets/[^/]+/[^/]+-${user().sheetId}\\.json$`).test(name));
        expect(sheets, `the sheet among ${[...files.keys()].join(", ")}`).toHaveLength(1);
        const sheet = JSON.parse(files.get(sheets[0])!.toString("utf8"));
        expect(sheet.characterInfo, "the sheet's content").toBeTypeOf("object");
        expectNoErrors([leaver]);
    });

    it("wiped after the deletion by the email's link, the player leaves the gm's list and their sheet is the gm's", async () => {
        await gm.openRoom(seed().roomId);
        expect(await sheetIn(folderIn(block(gm, user().id))).count(), "the leaver's sheet in their folder").toBe(1);
        // Gone after a reload, the mark shows the list changed in the open page.
        await gm.page.evaluate(() => { (window as unknown as { e2eNoReload: boolean }).e2eNoReload = true; });

        const page = leaver.page;
        await page.goto(`${config.base}/account/delete/token/${seed().account.deleteToken}`);
        await page.locator("#delete-phrase").fill(`delete ${user().name}`);
        await follow(page, page.locator("form.account-delete input[type=submit]"));
        expect(new URL(page.url()).pathname, "the grace page").toBe("/account/deletion");

        const res = await fetch(`${config.base}/dev/account-jobs/run`, { method: "POST", body: new URLSearchParams({ userID: String(user().id) }) });
        expect(res.status, "the pass of the account jobs").toBe(204);

        await eventually(() => block(gm, user().id).count(), n => expect(n, "the leaver in the gm's list").toBe(0));
        const own = block(gm, seedUser("gm").id);
        expect(await sheetIn(folderIn(own)).count(), "the leaver's sheet in the folder, now the gm's").toBe(1);
        expect(await gm.page.evaluate(() => (window as unknown as { e2eNoReload?: boolean }).e2eNoReload), "the gm's page not reloaded").toBe(true);

        // The grace page lets go of a wiped account.
        await page.goto(`${config.base}/account/deletion`);
        expect(new URL(page.url()).pathname, "where the grace page sends the wiped account").toBe("/user/login");
        expectNoErrors([gm, leaver]);
    });
});
