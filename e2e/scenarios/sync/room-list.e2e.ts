// The Characters list of the room as the owner of a sheet and another player
// see it: a rename shows at once in both lists, the access picked in the list
// decides what the player gets, a sheet dragged into a folder and out of it
// moves for both, and a deleted sheet leaves both lists and closes where it
// is open. Runs on the seeded room: `npm run seed`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator } from "playwright-core";
import { seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { createSheet, deleteSheet, expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("the room's character list", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;
    let sheet = 0;
    let folder = 0;
    let deleted = false;
    const room = () => seed().roomId;

    const row = (p: Player): Locator => p.page.locator(`#characters .character-sheet-entry[data-sheet-id="${sheet}"]`);
    const ownBlock = (p: Player) => p.page.locator(`#characters .player[data-user-id="${seedUser("gm").id}"]`);
    const folderOf = (p: Player): Locator => ownBlock(p).locator(`.folder[data-folder-id="${folder}"]`);
    const folderIds = async (p: Player) => (await ownBlock(p).locator(".folder").evaluateAll(els => els.map(el => Number((el as HTMLElement).dataset.folderId))));

    /** What `p` has of the sheet in the list: nothing, its name unlinked or its name as a link. */
    async function listed(p: Player): Promise<string> {
        if (await row(p).count() === 0) return "absent";
        return await row(p).locator(".name a").count() ? "linked" : "unlinked";
    }

    /** Where `p` lists the sheet: in the folder or outside folders. */
    async function where(p: Player): Promise<string> {
        if (await folderOf(p).locator(`.character-sheet-entry[data-sheet-id="${sheet}"]`).count()) return "folder";
        if (await ownBlock(p).locator(`.default-area .character-sheet-entry[data-sheet-id="${sheet}"]`).count()) return "loose";
        return "absent";
    }

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        player = await Player.create(browser, "player", { role: "player" });
        await gm.openRoom(room());
        sheet = await createSheet(gm);
        await player.openRoom(room());
    });

    afterAll(async () => {
        try {
            if (gm) {
                await gm.openRoom(room());
                if (sheet && !deleted) await deleteSheet(gm, sheet);
                if (folder) {
                    await gm.page.evaluate(folderId => document.dispatchEvent(new CustomEvent("room:sendMessage", {
                        detail: JSON.stringify({ type: "deleteFolder", eventID: crypto.randomUUID(), folderId }),
                    })), folder);
                    await gm.page.waitForTimeout(300);
                }
            }
        } finally {
            await browser?.close();
        }
    });

    it("the access picked in the list decides whether the player has the sheet, and whether as a link", async () => {
        const select = row(gm).locator(".entry-controls select");
        for (const [visibility, expected] of [
            ["hide_from_players", "absent"], ["everyone_can_see", "unlinked"], ["everyone_can_view", "linked"], ["hide_from_players", "absent"],
            ["everyone_can_edit", "linked"],
        ]) {
            await select.selectOption(visibility);
            await eventually(() => listed(player), v => expect(v, `player, ${visibility}`).toBe(expected));
            expect(await listed(gm), `gm, ${visibility}`).toBe("linked");
        }
        expectNoErrors([gm, player]);
    });

    it("a rename in the open sheet shows in both lists at once", async () => {
        await gm.switchTo(sheet);
        for (const name of ["e2e list", "e2e list renamed"]) {
            await gm.write("characterInfo.characterName", name);
            for (const p of [gm, player]) {
                await eventually(() => row(p).locator(".name").textContent(), v => expect(v?.trim(), `${p.name}: name in the list`).toBe(name));
            }
        }
        expectNoErrors([gm, player]);
    });

    it("dragged into a new folder, the sheet is in the folder for both", async () => {
        const before = await folderIds(gm);
        await gm.page.locator("#characters .create-folder-btn").click();
        folder = await eventually(async () => (await folderIds(gm)).find(id => !before.includes(id)) ?? 0, id => expect(id, "the new folder").toBeGreaterThan(0));
        await folderOf(gm).locator(".folder-collapse-btn").click();
        await row(gm).locator(".sheet-drag-handle").dragTo(folderOf(gm).locator(".folder-sheets"));
        for (const p of [gm, player]) await eventually(() => where(p), w => expect(w, `${p.name}: where the sheet is`).toBe("folder"));
        expectNoErrors([gm, player]);
    });

    it("dragged out of the folder, it is outside folders for both", async () => {
        await row(gm).locator(".sheet-drag-handle").dragTo(ownBlock(gm).locator('.default-area[data-folder-id="null"]'));
        for (const p of [gm, player]) await eventually(() => where(p), w => expect(w, `${p.name}: where the sheet is`).toBe("loose"));
        expectNoErrors([gm, player]);
    });

    it("deleted from the list, it leaves both lists and closes where it is open", async () => {
        await player.switchTo(sheet);
        await row(gm).locator(".delete-entry").click();
        await gm.page.locator("#confirm-modal button", { hasText: "OK" }).click();
        deleted = true;
        for (const p of [gm, player]) {
            await eventually(() => listed(p), v => expect(v, `${p.name}: in the list`).toBe("absent"));
            await eventually(() => p.page.locator("#charactersheet").count(), n => expect(n, `${p.name}: the open sheet`).toBe(0));
        }
        expectNoErrors([gm, player]);
    });
});
