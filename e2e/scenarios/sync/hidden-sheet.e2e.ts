// The edits of a hidden sheet stay out of the traffic of the players who may
// not see it: the server sends them only to the room members who may view the
// sheet (internal/roomws/sheet_items.go). Runs on the seeded room: `npm run seed`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seed } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import type { Msg } from "../../lib/probes";
import { createSheet, deleteSheet, expectNoErrors, setVisibility } from "../../lib/table";

describe("a hidden sheet", () => {
    let browser: Browser;
    let gm: Player;
    let moderator: Player;
    let player: Player;
    let sheet = 0;
    const room = () => seed().roomId;
    const editOf = (m: Msg) => m.type === "change" && String(m.sheetID) === String(sheet);

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        moderator = await Player.create(browser, "moderator", { role: "moderator" });
        player = await Player.create(browser, "player", { role: "player" });
        await gm.openRoom(room());
        sheet = await createSheet(gm);
        await setVisibility(gm, sheet, "hide_from_players");
        await gm.openSheet(room(), sheet);
        await moderator.openRoom(room());
        await player.openRoom(room());
    });

    afterAll(async () => {
        try {
            if (gm && sheet) {
                await gm.openRoom(room());
                await deleteSheet(gm, sheet);
            }
        } finally {
            await browser?.close();
        }
    });

    it("sends its edits to the moderator and not to a player", async () => {
        await moderator.clearRecords({ settle: false });
        await player.clearRecords({ settle: false });
        await gm.write("characterInfo.characterName", "e2e hidden");
        await moderator.waitReceived(editOf, "the edit of the hidden sheet");
        // The server sends an edit to all its recipients at once: by now the player would have it.
        await player.page.waitForTimeout(500);
        expect((await player.received()).filter(editOf)).toEqual([]);
        expectNoErrors([gm, moderator, player]);
    });

    it("sends them to a player once it is visible", async () => {
        await setVisibility(gm, sheet, "everyone_can_view");
        await player.waitReceived(m => m.type === "changeSheetVisibility" && String(m.sheetID) === String(sheet), "the visibility change");
        await player.clearRecords({ settle: false });
        await gm.write("characterInfo.characterName", "e2e visible");
        await player.waitReceived(m => editOf(m) && m.change === "e2e visible", "the edit of the sheet made visible");
        expectNoErrors([gm, moderator, player]);
    });
});
