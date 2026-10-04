// The stat block of the participant picked in the encounter window: the
// gamemaster fights an NPC from it (rolls under its name for the players,
// ammo, conditions, fatigue) and a character's as well, and a sheet opened
// from the room list takes the place of GM mode. Runs on the seeded
// room: `npm run seed`. Acceptance checklist, items 17–19.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator } from "playwright-core";
import type { Msg } from "../../lib/probes";
import { seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import {
    addSheets, card, closePopup, deleteEncounter, enterGmMode, newEncounter, newNpc, openEncounterId, openPopup, renameSheet,
    setDisplayName,
} from "../../lib/encounter";

const REAL = "e2e Statblock Orc";
const SHOWN = "e2e Hulking Shape";
const WEAPON = "e2e Shoota";
const CONDITION = "e2e Pinned";

describe("the stat block", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;
    let encounter = 0;
    let npc = 0;
    const character = () => seedUser("player").sheetId!;
    const block = (): Locator => gm.page.locator("#statblock-sheet .stat-block");

    /** Picks the participant of `sheetId` and waits for their stat block. */
    async function pick(sheetId: number): Promise<void> {
        await card(gm, sheetId).locator(".encounter-card-title").click();
        await gm.page.locator(`#statblock-sheet[data-sheet-id="${sheetId}"]`).waitFor();
        await block().waitFor();
    }

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        player = await Player.create(browser, "player", { role: "player" });
        await player.openRoom(seed().roomId);
        await gm.openRoom(seed().roomId);
        await enterGmMode(gm);
        encounter = await newEncounter(gm);
        await addSheets(gm, [character()]);
        npc = await newNpc(gm);
        await renameSheet(gm, npc, REAL);
        await setDisplayName(gm, npc, SHOWN);

        // A ranged attack with the default roll, from the NPC's sheet.
        await openPopup(gm, npc);
        const popup = gm.page.locator("#popup-sheet");
        await popup.locator('label[for="show-combat"]').click();
        await popup.locator("#ranged-attack .add-button").first().click();
        const attack = popup.locator(".ranged-attack").first();
        await attack.locator('[data-id="name"]').first().fill(WEAPON);
        await attack.locator('[data-id="clipCur"]').fill("18");
        await attack.locator('[data-id="clipMax"]').fill("30");
        // The open tab is the sheet's: openPopup waits for the name on the first one.
        await popup.locator('label[for="show-player-sheet"]').click();
        // A condition, on from the start: the stat block switches conditions, the sheet adds them.
        await popup.locator(".char-dropdown-toggle").click();
        await popup.locator("#conditions .add-button").first().click();
        await popup.locator('.condition-item [data-id="name"]').first().fill(CONDITION);
        await closePopup(gm);
    });

    afterEach(() => expectNoErrors([gm, player]));

    afterAll(async () => {
        try {
            if (encounter) await deleteEncounter(gm, encounter);
        } finally {
            await browser?.close();
        }
    });

    it("rolls an NPC's characteristic and attack to the chat under its name for the players", async () => {
        await pick(npc);
        await player.clearRecords({ settle: false });

        await block().locator('[data-id="WS"] label.rollable').click();
        const test = await player.waitReceived(m => m.type === "chatMessage" && String(m.messageBody).startsWith("/r d100 vs"), "the test");
        expect(test.characterName).toBe(SHOWN);

        const attack = block().locator(".stat-ranged").filter({ hasText: WEAPON });
        await attack.locator(".stat-attack-name label.rollable").click();
        await attack.locator('[data-id="roll"].visible [data-id="rollButton"]').click();
        const shot = await player.waitReceived(
            m => m.type === "chatMessage" && String(m.messageBody).includes(WEAPON), "the attack");
        expect(shot.characterName).toBe(SHOWN);

        expect(JSON.stringify(await player.received())).not.toContain(REAL);
        expect(await player.page.locator("#chat").textContent()).not.toContain(REAL);
    });

    it("edits an NPC's ammo, conditions and fatigue as its sheet", async () => {
        await pick(npc);
        await block().locator('.stat-ranged [data-id="clipCur"]').fill("17");
        await block().locator(".stat-condition").filter({ hasText: CONDITION }).locator('[data-id="enabled"]').uncheck();
        await block().locator('[data-id="fatigue"] [data-id="fatigueCur"]').fill("2");
        // The popup shows the same instance: the edits must also have left the page.
        const ofNpc = (m: Msg) => String(m.sheetID) === String(npc);
        await gm.waitSent(m => ofNpc(m) && String(m.path).endsWith(".clipCur") && m.change === "17", "the ammo");
        const off = await gm.waitSent(m => ofNpc(m) && /^conditions\.list\.items\.[^.]+\.enabled$/.test(m.path) && m.change === false, "the condition");
        await gm.waitSent(m => ofNpc(m) && m.path === "fatigue.fatigueCur", "the fatigue");

        await openPopup(gm, npc);
        const popup = gm.page.locator("#popup-sheet");
        await popup.locator(".char-dropdown-toggle").click();
        const conditionId = String(off.path).split(".")[3];
        expect(await popup.locator(`.condition-item[data-id="${conditionId}"] > .split-header [data-id="enabled"]`).isChecked()).toBe(false);
        await popup.locator('label[for="show-combat"]').click();
        expect(await popup.locator('.ranged-attack [data-id="clipCur"]').first().inputValue()).toBe("17");
        expect(await popup.locator('[data-id="fatigue"] [data-id="fatigueCur"]').first().inputValue()).toBe("2");
        await popup.locator('label[for="show-player-sheet"]').click();
        await closePopup(gm);
    });

    it("rolls a character's characteristic, as the gamemaster may edit the sheet", async () => {
        await pick(character());
        await player.clearRecords({ settle: false });
        await block().locator('[data-id="WS"] label.rollable').click();
        await player.waitReceived(m => m.type === "chatMessage" && String(m.messageBody).startsWith("/r d100 vs"), "the test");
        // Seeded data: the scenario leaves the character's fields as they are.
        expect(await block().locator('[data-id="fatigueCur"]').getAttribute("readonly")).toBeNull();
    });

    it("gives way to a sheet opened from the room list, and comes back with the same encounter", async () => {
        await gm.page.locator(`#characters a[href="/sheet/view/${character()}"]`).click();
        await eventually(() => gm.page.locator("#room").getAttribute("class"), cls => expect(cls).not.toContain("gm-mode"));
        await gm.page.locator(`#charactersheet[data-sheet-id="${character()}"]`).waitFor();

        await enterGmMode(gm);
        expect(await openEncounterId(gm)).toBe(encounter);
        await card(gm, npc).waitFor();
    });
});
