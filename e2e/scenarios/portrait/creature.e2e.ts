// The portrait of a bestiary creature: the gamemaster adds it in the
// creature's full sheet on the bestiary page, and an NPC of the creature in
// an encounter carries it. Only full sheets show it, never a stat block: the
// bestiary's creature panel, the encounter's column, its cards. Runs on the
// seeded room (`npm run seed`); the collection and the encounter are deleted
// at the end, with their portraits.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator, Page } from "playwright-core";
import { config, seed } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { bestiary, deleteCollections, uploadCreature } from "../../lib/bestiary";
import { addCreature, card, closePopup, columnSheets, deleteEncounter, enterGmMode, newEncounter, openPopup } from "../../lib/encounter";
import { hashOf, pickFile, pngFile, servedSize } from "../../lib/portrait";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";

const COLLECTION = "e2e Portrait";
const ORC = "e2e Portrait Orc";

const fullImg = (page: Page): Locator => page.locator("#popup-sheet .portrait-cell .portrait > img");
const statBlockPortraits = (page: Page): Locator => page.locator("#statblock-sheet .portrait-cell");

describe("the portrait of a creature", () => {
    let browser: Browser;
    let gm: Player;
    let collection = 0;
    let creature = 0;
    let encounter = 0;
    let hash = "";

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        await gm.openRoom(seed().roomId);
        // What a failed run left.
        await deleteCollections(gm.page, COLLECTION);
        collection = (await bestiary<{ id: number }>(gm.page, "POST", "/bestiary/collections", { name: COLLECTION })).id;
        creature = await uploadCreature(gm.page, collection, ORC);
    });

    afterEach(() => expectNoErrors([gm]));

    afterAll(async () => {
        try {
            if (encounter) await deleteEncounter(gm, encounter);
            await deleteCollections(gm.page, COLLECTION);
        } finally {
            await browser?.close();
        }
    });

    it("is added in the creature's full sheet, and its stat block does not show it", async () => {
        const page = gm.page;
        await page.goto(`${config.base}/bestiary?collection=${collection}`);
        await page.waitForFunction(() => window.__e2e.socketOpen());
        await page.locator(`.bestiary-table tr[data-creature-id="${creature}"]`).click();
        await page.locator(`#statblock-sheet[data-sheet-id="${creature}"] .stat-block`).waitFor();
        await page.locator(".bestiary-open-sheet").click();
        await page.locator('#popup-sheet [data-id="characterName"]').first().waitFor();

        await pickFile(page, page.locator("#popup-sheet .portrait.empty"), await pngFile(page, 600, 900));
        const pop = page.locator("#popup-sheet .crop-pop");
        await pop.locator(".crop-save:enabled").click();
        await pop.waitFor({ state: "detached" });
        // The bestiary page takes the hash from portraitChanged too.
        await eventually(() => fullImg(page).getAttribute("src"), src => expect(src).toMatch(/^\/portrait\/[0-9a-f]{16}$/));
        hash = await hashOf(fullImg(page));
        expect(await servedSize(fullImg(page))).toEqual({ width: 360, height: 480 });

        await page.locator(".sheet-popup-close").click();
        await page.locator(".sheet-popup").waitFor({ state: "detached" });
        await page.locator(`#statblock-sheet[data-sheet-id="${creature}"] .stat-block`).waitFor();
        expect(await statBlockPortraits(page).count(), "a portrait in the creature panel").toBe(0);
        expect((await bestiary<{ portrait: string | null }>(page, "GET", `/sheet/view/${creature}`)).portrait).toBe(hash);
    });

    it("comes with the creature into an encounter: the NPC's full sheet shows it, its stat block does not", async () => {
        const page = gm.page;
        await gm.openRoom(seed().roomId);
        await enterGmMode(gm);
        encounter = await newEncounter(gm);
        const before = await columnSheets(gm, "enemies");
        await addCreature(gm, collection, creature, 1);
        const after = await eventually(() => columnSheets(gm, "enemies"), ids => expect(ids.length, "the new NPC").toBe(before.length + 1));
        const npc = after.find(id => !before.includes(id))!;

        await openPopup(gm, npc);
        await eventually(() => fullImg(page).getAttribute("src"), src => expect(src, "the NPC's portrait").toBe(`/portrait/${hash}`));
        expect(await servedSize(fullImg(page))).toEqual({ width: 360, height: 480 });
        await closePopup(gm);

        await card(gm, npc).locator(".encounter-card-title").click();
        await page.locator(`#statblock-sheet[data-sheet-id="${npc}"] .stat-block`).waitFor();
        expect(await statBlockPortraits(page).count(), "a portrait in the stat block column").toBe(0);
        expect(await page.locator('.encounter-window img[src^="/portrait/"]').count(), "a portrait in the encounter window").toBe(0);
    });
});
