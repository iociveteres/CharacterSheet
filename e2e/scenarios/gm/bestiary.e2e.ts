// The bestiary from the room and on its page: the gamemaster has a default
// collection that stays private, saves an NPC to a collection, adds the
// creature to the encounter three times, adds an edited copy as a variant
// next to it, makes a blank creature and uploads files past the quota.
// Runs on the seeded room: `npm run seed`. Acceptance checklist, items 15
// (the shared collections: sharing.e2e.ts) and 16.
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { config, seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import { bestiary, expectToast, listCollections, type Creature } from "../../lib/bestiary";
import {
    card, closePopup, deleteEncounter, editsStored, enterGmMode, gmOrder, newEncounter, newNpc, openPopup, renameSheet,
    typeInitiative,
} from "../../lib/encounter";

const COLLECTION = "e2e Bestiary";
const ORC = "e2e Bestiary Orc";
const NOB = "e2e Bestiary Nob";
const COPIES = [`${ORC} 1`, `${ORC} 2`, `${ORC} 3`];
// What the server names a blank creature.
const BLANK = "New creature";

const collections = async (page: Page) =>
    (await listCollections(page)).filter(c => c.own && c.name === COLLECTION);

describe("the bestiary", () => {
    let browser: Browser;
    let gm: Player;
    let encounter = 0;
    let collection = 0;
    let creature = 0;
    const copies: number[] = [];

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        await gm.openRoom(seed().roomId);
        // What a failed run left.
        for (const c of await collections(gm.page)) await bestiary(gm.page, "DELETE", `/bestiary/collections/${c.id}`);
        await enterGmMode(gm);
        encounter = await newEncounter(gm);
    });

    afterEach(() => expectNoErrors([gm]));

    afterAll(async () => {
        try {
            if (encounter) await deleteEncounter(gm, encounter);
            for (const c of await collections(gm.page)) await bestiary(gm.page, "DELETE", `/bestiary/collections/${c.id}`);
        } finally {
            await browser?.close();
        }
    });

    it("has a default collection that cannot be deleted or made public", async () => {
        const page = await gm.context.newPage();
        try {
            await page.goto(`${config.base}/bestiary`);
            const own = (await listCollections(page)).filter(c => c.own && c.default);
            expect(own).toHaveLength(1);
            expect(own[0].visibility).toBe("private");
            const row = page.locator(`.bestiary-collection[data-collection-id="${own[0].id}"]`);
            expect(await row.locator(".bestiary-default").textContent()).toBe("default");
            await row.click();
            await page.locator(".bestiary-collection-menu .bestiary-menu-btn").click();
            await page.getByRole("menuitem", { name: "Rename" }).waitFor();
            const items = (await page.getByRole("menuitem").allTextContents()).map(t => t.trim());
            expect(items).toEqual(expect.arrayContaining(["Rename", "Description", "Tags", "Export"]));
            expect(items).not.toContain("Delete");
            expect(items).not.toContain("Make public…");
            // Nor does the server take it.
            const tries = await page.evaluate(async id => {
                const token = (JSON.parse(document.getElementById("bestiary-state")!.textContent!) as { csrfToken: string }).csrfToken;
                const headers = { "X-CSRF-Token": token, "Content-Type": "application/json" };
                const publish = await fetch(`/bestiary/collections/${id}`, { method: "PATCH", headers, body: JSON.stringify({ visibility: "public" }) });
                const remove = await fetch(`/bestiary/collections/${id}`, { method: "DELETE", headers });
                return [publish.status, remove.status];
            }, own[0].id);
            expect(tries).toEqual([400, 400]);
        } finally {
            await page.close();
        }
    });

    it("saves an NPC to a new collection", async () => {
        const npc = await newNpc(gm);
        await renameSheet(gm, npc, ORC);
        // The server copies what it has stored, not what the card shows.
        await editsStored(gm, npc);
        await card(gm, npc).locator(".encounter-npc-menu-btn").click();
        await card(gm, npc).locator(".encounter-save-to-collection").click();
        const dialog = gm.page.locator(".save-to-collection-modal");
        await dialog.locator(".save-to-collection-target").selectOption("new");
        await dialog.locator(".save-to-collection-name").fill(COLLECTION);
        await dialog.locator(".save-to-collection-save").click();
        await expectToast(gm.page, `"${ORC}" saved to ${COLLECTION}`);

        const [saved] = await collections(gm.page);
        collection = saved.id;
        const creatures = await bestiary<Creature[]>(gm.page, "GET", `/bestiary/creatures?collection=${collection}`);
        expect(creatures.map(c => c.name)).toEqual([ORC]);
        creature = creatures[0].id;

        // Out of the encounter, so that the copies are numbered from 1.
        await card(gm, npc).locator(".encounter-remove").click();
        await gm.page.locator("#confirm-modal button", { hasText: "OK" }).click();
        await card(gm, npc).waitFor({ state: "detached" });
    });

    it("adds the creature three times from the bestiary, each in a group of its own", async () => {
        await gm.page.locator(".encounter-from-bestiary").click();
        const dialog = gm.page.locator(".encounter-from-bestiary-modal");
        await dialog.locator('select[aria-label="Collection"]').selectOption(String(collection));
        await dialog.locator(`.encounter-creature[data-creature-id="${creature}"]`).click();
        await dialog.locator(".encounter-creature-count").fill("3");
        await dialog.locator(".encounter-add-creature").click();

        const titles = gm.page.locator('[data-column="npc"] .encounter-card-title');
        await eventually(() => titles.allTextContents(), names => expect(names.sort()).toEqual(COPIES));
        const order = await gmOrder(gm);
        for (const name of COPIES) expect(order.map(([n]) => n.replace("*", ""))).toContain(name);
        copies.push(...await gm.page.locator('[data-column="npc"] .encounter-card').evaluateAll(
            els => els.map(el => Number((el as HTMLElement).dataset.sheetId))));
    });

    it("adds an edited copy as a variant next to the creature, which stays as it was", async () => {
        const copy = card(gm, copies[0]);
        const name = await copy.locator(".encounter-card-title").textContent();
        await copy.locator(".encounter-wounds-minus").click();
        await openPopup(gm, copies[0]);
        const popup = gm.page.locator("#popup-sheet");
        await popup.locator(".char-dropdown-toggle").click();
        await popup.locator('.perm-temp-section [data-id="WS"] [data-id="value"]').fill("47");
        await closePopup(gm);
        const row = (await gmOrder(gm)).findIndex(([n]) => n.replace("*", "") === name);
        await typeInitiative(gm, row, 15);
        await gm.waitSent(m => String(m.sheetID) === String(copies[0]) && m.path === "initiative.lastInitiative", "the initiative");
        await editsStored(gm, copies[0]);

        await copy.locator(".encounter-npc-menu-btn").click();
        await copy.locator(".encounter-add-variant").click();
        const dialog = gm.page.locator(".add-variant-modal");
        expect(await dialog.locator(".add-variant-name").inputValue()).toBe(name);
        await dialog.locator(".add-variant-name").fill(NOB);
        await dialog.locator(".add-variant-add").click();
        await expectToast(gm.page, `"${NOB}" added to ${COLLECTION}`);

        const creatures = await bestiary<Creature[]>(gm.page, "GET", `/bestiary/creatures?collection=${collection}`);
        expect(creatures.map(c => c.name)).toEqual([NOB, ORC]);
        const nob = creatures.find(c => c.name === NOB)!.id;
        const page = await gm.context.newPage();
        try {
            await page.goto(`${config.base}/bestiary`);
            await page.locator(`.bestiary-collection[data-collection-id="${collection}"]`).click();
            await page.locator(`.bestiary-table tr[data-creature-id="${nob}"]`).click();
            await page.locator(`#statblock-sheet[data-sheet-id="${nob}"] .stat-block`).waitFor();
            await eventually(() => page.locator('#statblock-sheet [data-id="WS"] [data-id="calculatedValue"]').textContent(),
                ws => expect(ws).toBe("47"));
            const variant = await bestiary<{ content: any }>(page, "GET", `/sheet/view/${nob}`);
            expect(variant.content.characterInfo.characterName).toBe(NOB);
            expect(Number(variant.content.armour.woundsCur)).toBe(1);
            expect(Number(variant.content.initiative.lastInitiative)).toBe(0);
            const source = await bestiary<{ content: any }>(page, "GET", `/sheet/view/${creature}`);
            expect(source.content.characterInfo.characterName).toBe(ORC);
            expect(Number(source.content.armour?.woundsCur ?? 0)).toBe(0);
        } finally {
            await page.close();
        }
        // The copy goes on from the variant.
        await copy.locator(".encounter-npc-menu-btn").click();
        expect(await copy.locator(".encounter-add-variant").getAttribute("title")).toBe(`A new creature next to "${NOB}"`);
        await copy.locator(".encounter-npc-menu-btn").click();
    });

    it("makes a blank creature of the chosen kind in the collection and opens its sheet", async () => {
        const page = await gm.context.newPage();
        try {
            await page.goto(`${config.base}/bestiary?collection=${collection}`);
            await page.locator(`.bestiary-table tr[data-creature-id="${creature}"]`).waitFor();
            const kinds = page.locator(".bestiary-new-creature-kind");
            // With one kind there is nothing to choose.
            const kind = await kinds.count()
                ? await kinds.locator("option").last().getAttribute("value")
                : "black_crusade";
            if (await kinds.count()) await kinds.selectOption(kind!);
            await page.locator(".bestiary-new-creature").click();

            const row = page.locator(".bestiary-table tr.selected");
            await eventually(() => row.locator(".bestiary-creature-name").textContent(), name => expect(name).toBe(BLANK));
            const id = Number(await row.getAttribute("data-creature-id"));
            await page.locator(`#popup-sheet[data-sheet-id="${id}"]`).waitFor();
            expect(await page.locator(".sheet-popup").count()).toBe(1);
            const creatures = await bestiary<(Creature & { kind: string })[]>(page, "GET", `/bestiary/creatures?collection=${collection}`);
            expect(creatures.find(c => c.id === id)).toMatchObject({ name: BLANK, kind });
            await page.locator(".sheet-popup-close").click();
            await page.locator(".sheet-popup").waitFor({ state: "detached" });
        } finally {
            await page.close();
        }
    });

    it("stops an upload at the file over the quota and keeps what came before it", async () => {
        const page = await gm.context.newPage();
        try {
            await page.goto(`${config.base}/bestiary`);
            await page.locator(`.bestiary-collection[data-collection-id="${collection}"]`).click();
            await page.locator(`.bestiary-table tr[data-creature-id="${creature}"]`).waitFor();

            const sheet = await bestiary<{ content: any }>(page, "GET", `/sheet/view/${seedUser("player").sheetId}`);
            const file = (name: string, characterName: string) => ({
                name,
                mimeType: "application/json",
                buffer: Buffer.from(JSON.stringify({ ...sheet.content, characterInfo: { ...sheet.content.characterInfo, characterName } })),
            });
            // Past the 5 MB of NPCs and creatures by itself: random text, which
            // Postgres stores as large as it is, unlike repeated letters.
            const huge = file("huge.json", randomBytes(5 << 20).toString("base64"));
            await page.locator('.bestiary input[type="file"]').setInputFiles([file("first.json", "e2e Uploaded"), huge, file("last.json", "e2e Not uploaded")]);

            const notice = page.locator(".toasts > .toast");
            await notice.waitFor();
            const text = await notice.textContent();
            expect(text).toContain("first.json: 1 creature");
            expect(text).toMatch(/huge\.json: NPCs and creatures take [\d.]+ of 5 MB; this needs [\d.]+ MB more\./);
            expect(text).toContain("last.json: not uploaded");
            await eventually(() => page.locator(".bestiary-creature-name").allTextContents(),
                names => expect(names.sort()).toEqual([BLANK, NOB, ORC, "e2e Uploaded"].sort()));
        } finally {
            await page.close();
        }
    });
});
