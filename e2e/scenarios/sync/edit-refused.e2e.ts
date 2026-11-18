// An edit the server refuses: the gamemaster takes the player's edit rights
// away while the news is still on its way, so the player edits a sheet the
// page still shows as editable. The player is told, and the sheet is read
// again with what the server has. Runs on the seeded room (`npm run seed`); checks no
// wording, only that a notice is shown.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seed } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { createSheet, deleteSheet, expectNoErrors, setVisibility } from "../../lib/table";
import { eventually, sleep } from "../../lib/wait";

const RACE = "characterInfo.race";

describe("an edit the server refuses", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;
    let sheet = 0;
    /** While set, the player's page does not get visibility changes. */
    let holdVisibility = false;

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        player = await Player.create(browser, "player", { role: "player" });
        await gm.openRoom(seed().roomId);
        sheet = await createSheet(gm);
        await setVisibility(gm, sheet, "everyone_can_edit");
        await gm.openSheet(seed().roomId, sheet);

        await player.dropIncoming("changeSheetVisibility", () => holdVisibility);
        await player.openSheet(seed().roomId, sheet);
        await gm.openNavTab("player");
        await player.openNavTab("player");
    });

    afterEach(() => expectNoErrors([gm, player]));

    afterAll(async () => {
        try {
            if (sheet) {
                await gm.openRoom(seed().roomId);
                await deleteSheet(gm, sheet);
            }
        } finally {
            await browser?.close();
        }
    });

    it("the player may edit the shared sheet", async () => {
        expect((await player.sheetState()).canEdit).toBe(true);
        await player.write(RACE, "e2e granted");
        await gm.expectValue(RACE, "e2e granted");
    });

    it("an edit made after the rights are gone is refused: the player gets a notice and the sheet as the server has it", async () => {
        holdVisibility = true;
        await setVisibility(gm, sheet, "everyone_can_view");
        // Long enough for the change to have reached the player, had it not been held.
        await sleep(300);
        expect(await player.attr(RACE, "readonly"), "the page still offers the field").toBeNull();
        await player.clearRecords();
        const inserted = await player.page.evaluate(() => window.__e2e.inserted);

        await player.write(RACE, "e2e refused");
        const change = await player.waitSent(m => m.type === "change" && m.path === RACE, "the race");
        const answer = await player.waitReceived(m => m.type === "response" && m.eventID === change.eventID, "the answer");
        expect(answer.OK).toBe(false);
        expect(answer.code).toBe("permission");

        await player.waitNotices(1);
        await eventually(() => player.page.evaluate(() => window.__e2e.inserted), n => expect(n, "the sheet is read again").toBeGreaterThan(inserted));
        await player.expectValue(RACE, "e2e granted");
        await eventually(() => player.attr(RACE, "readonly"), ro => expect(ro, "the field is read-only now").not.toBeNull());
        expect((await gm.sheetState()).content.characterInfo.race).toBe("e2e granted");
    });
});
