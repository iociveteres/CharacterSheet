// Shared collections: the outsider makes a collection public, the gamemaster
// finds it in the catalog and reads it without a subscription, copies a
// creature to their own collection, subscribes and adds the creature to the
// encounter; the collection made private leaves the gamemaster's list and
// "From bestiary" and comes back when public again, until they unsubscribe.
// Runs on the seeded room: `npm run seed`. Acceptance checklist, item 15
// (with bestiary.e2e.ts).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { config, seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import { bestiary, deleteCollections, expectToast, listCollections } from "../../lib/bestiary";
import { card, deleteEncounter, enterGmMode, newEncounter } from "../../lib/encounter";

const PREFIX = "e2e Sharing";
const XENOS = `${PREFIX} Xenos`;
const COPIES = `${PREFIX} Copies`;
const TAG = "e2e-sharing";
const KROOT = "e2e Kroot";
const LISTED = `${XENOS} · ${seedUser("outsider").name}`;
const SOURCE = `Source: ${XENOS} · ${seedUser("outsider").name}`;

/** Opens the bestiary page in a new tab of `p`. */
async function bestiaryPage(p: Player): Promise<Page> {
    const page = await p.context.newPage();
    await page.goto(`${config.base}/bestiary`);
    await page.locator(".bestiary-collections .bestiary-new-collection").waitFor();
    return page;
}

/** The names in a section of the list on the bestiary page: own or subscribed. */
const section = (page: Page, name: string) => page.locator(`[data-section="${name}"] .bestiary-collection-name`).allTextContents();

/** The names under "Subscriptions" on a new bestiary page of `p`, once its list is read. */
async function subscriptions(p: Player): Promise<string[]> {
    const page = await bestiaryPage(p);
    try {
        // The user's default collection is always there once the list is read.
        await page.locator('[data-section="own"] .bestiary-default').waitFor();
        return await section(page, "subscribed");
    } finally {
        await page.close();
    }
}

/** The collections "From bestiary" of the room offers `p`, once it has read them. */
async function fromBestiary(p: Player): Promise<number[]> {
    await p.page.locator(".encounter-from-bestiary").click();
    const options = p.page.locator('.encounter-from-bestiary-modal select[aria-label="Collection"] option');
    // "All collections" and, once read, at least the user's default collection.
    await eventually(() => options.count(), n => expect(n).toBeGreaterThan(1));
    const ids = (await options.evaluateAll(els => els.map(el => (el as HTMLOptionElement).value))).filter(Boolean).map(Number);
    await p.page.keyboard.press("Escape");
    await p.page.locator(".encounter-from-bestiary-modal").waitFor({ state: "detached" });
    return ids;
}

describe("shared collections", () => {
    let browser: Browser;
    let gm: Player;
    let outsider: Player;
    let outsiderPage: Page;
    let encounter = 0;
    let collection = 0;
    let creature = 0;

    /** The outsider makes the collection private or public from its menu, as the page shows it. */
    async function setVisibility(visibility: "private" | "public"): Promise<void> {
        const page = outsiderPage;
        await page.reload();
        await page.locator(`.bestiary-collection[data-collection-id="${collection}"]`).click();
        await page.locator(".bestiary-collection-menu .bestiary-menu-btn").click();
        await page.getByRole("menuitem", { name: visibility === "public" ? "Make public…" : "Make private" }).click();
        if (visibility === "public") await page.locator(".bestiary-confirm-ok").click();
        await eventually(() => page.locator(".bestiary-collection-view .bestiary-visibility").textContent(), v => expect(v).toBe(visibility));
    }

    /** Whether the gamemaster has the collection in "Subscriptions" and in "From bestiary". */
    async function listed(): Promise<[boolean, boolean]> {
        return [(await subscriptions(gm)).includes(LISTED), (await fromBestiary(gm)).includes(collection)];
    }

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        outsider = await Player.create(browser, "outsider", { role: "outsider" });
        await gm.openRoom(seed().roomId);
        outsiderPage = outsider.page;
        await outsiderPage.goto(`${config.base}/bestiary`);
        // What a failed run left: deleting the collection also ends the subscription.
        await deleteCollections(gm.page, PREFIX);
        await deleteCollections(outsiderPage, PREFIX);
        await enterGmMode(gm);
        encounter = await newEncounter(gm);
    });

    afterEach(() => expectNoErrors([gm, outsider]));

    afterAll(async () => {
        try {
            if (encounter) await deleteEncounter(gm, encounter);
            await deleteCollections(gm.page, PREFIX);
            await deleteCollections(outsiderPage, PREFIX);
        } finally {
            await browser?.close();
        }
    });

    it("the outsider makes a public collection", async () => {
        const page = outsiderPage;
        await page.reload();
        await page.locator(".bestiary-new-collection").click();
        await page.locator(".bestiary-dialog-text").fill(XENOS);
        await page.locator(".bestiary-dialog-ok").click();
        await eventually(() => page.locator(".bestiary-collection-view .bestiary-title").textContent(), t => expect(t).toBe(XENOS));
        collection = Number(await page.locator(".bestiary-collection-view").getAttribute("data-collection-id"));

        await page.locator(".bestiary-collection-menu .bestiary-menu-btn").click();
        await page.getByRole("menuitem", { name: "Tags" }).click();
        await page.locator(".bestiary-tag-field").fill(TAG);
        await page.locator(".bestiary-tag-field").press("Enter");
        await page.locator(".bestiary-dialog-ok").click();
        await page.locator(".bestiary-dialog").waitFor({ state: "detached" });

        await page.locator('.bestiary input[type="file"]').setInputFiles({
            name: "kroot.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify({ sheetKind: "black_crusade", characterInfo: { characterName: KROOT } })),
        });
        await expectToast(page, "kroot.json: 1 creature");
        await eventually(() => page.locator(".bestiary-creature-name").allTextContents(), names => expect(names).toEqual([KROOT]));
        creature = Number(await page.locator(".bestiary-table tbody tr").getAttribute("data-creature-id"));

        await setVisibility("public");
    });

    it("the gamemaster finds it in the catalog and reads it without a subscription", async () => {
        const page = await bestiaryPage(gm);
        try {
            await page.locator(".bestiary-catalog-link").click();
            await page.locator(".bestiary-catalog-search").fill(XENOS);
            await page.locator(".bestiary-catalog-tag").fill(TAG);
            await eventually(() => page.locator(".bestiary-catalog-table tbody tr").evaluateAll(
                rows => rows.map(r => (r as HTMLElement).dataset.collectionId)), ids => expect(ids).toEqual([String(collection)]));

            await page.locator(`.bestiary-catalog-table tr[data-collection-id="${collection}"] .bestiary-catalog-name`).click();
            await eventually(() => page.locator(".bestiary-collection-view").getAttribute("data-collection-id"), id => expect(id).toBe(String(collection)));
            expect(await page.locator(".bestiary-subscribe").textContent()).toBe("Subscribe");
            expect(await section(page, "subscribed")).not.toContain(LISTED);
            await page.locator(`.bestiary-table tr[data-creature-id="${creature}"]`).click();
            await page.locator(`#statblock-sheet[data-sheet-id="${creature}"] .stat-block`).waitFor();
            expect(await page.locator(".bestiary-creature-menu").count()).toBe(0);
            expect(await page.locator(".bestiary-upload").count()).toBe(0);
            expect(await page.locator(".bestiary-new-creature").count()).toBe(0);
            // The stat block of another user's creature has no field to type into.
            const editable = await page.locator("#statblock-sheet").evaluate(host =>
                [...host.shadowRoot!.querySelectorAll<HTMLInputElement>("input, textarea, select")].filter(f => !f.readOnly && !f.disabled).length);
            expect(editable).toBe(0);

            await page.locator(".bestiary-copy-to-mine").click();
            await page.locator(".bestiary-dialog-target").selectOption({ label: "New collection…" });
            await page.locator(".bestiary-new-collection-name").fill(COPIES);
            await page.locator(".bestiary-dialog-ok").click();
            await expectToast(page, `"${KROOT}" copied to ${COPIES}`);

            const copies = (await listCollections(page)).find(c => c.own && c.name === COPIES)!;
            await page.locator(`.bestiary-collection[data-collection-id="${copies.id}"]`).click();
            await page.locator(".bestiary-table tbody tr").first().click();
            await eventually(() => page.locator(".bestiary-source").textContent(), s => expect(s).toBe(SOURCE));
        } finally {
            await page.close();
        }
        expect(await fromBestiary(gm)).not.toContain(collection);
    });

    it("subscribed, the gamemaster has it in the list and adds its creature twice as NPCs signed with their source", async () => {
        const page = await bestiaryPage(gm);
        try {
            await page.locator(".bestiary-catalog-link").click();
            await page.locator(".bestiary-catalog-search").fill(XENOS);
            await page.locator(`.bestiary-catalog-table tr[data-collection-id="${collection}"] .bestiary-catalog-name`).click();
            await page.locator(".bestiary-subscribe").click();
            await eventually(() => section(page, "subscribed"), names => expect(names).toContain(LISTED));
            expect(await page.locator(".bestiary-subscribe").textContent()).toBe("Unsubscribe");
        } finally {
            await page.close();
        }
        expect(await listed()).toEqual([true, true]);

        await gm.page.locator(".encounter-from-bestiary").click();
        const dialog = gm.page.locator(".encounter-from-bestiary-modal");
        await dialog.locator('select[aria-label="Collection"]').selectOption(String(collection));
        await dialog.locator(`.encounter-creature[data-creature-id="${creature}"]`).click();
        await dialog.locator(".encounter-creature-count").fill("2");
        await dialog.locator(".encounter-add-creature").click();

        const titles = gm.page.locator('[data-column="npc"] .encounter-card-title');
        await eventually(() => titles.allTextContents(), names => expect(names.sort()).toEqual([`${KROOT} 1`, `${KROOT} 2`]));
        const npc = Number(await gm.page.locator('[data-column="npc"] .encounter-card').first().getAttribute("data-sheet-id"));
        await card(gm, npc).locator(".encounter-card-title").click();
        await gm.page.locator(`#statblock-sheet[data-sheet-id="${npc}"]`).waitFor();
        expect(await gm.page.locator(".statblock-source").textContent()).toBe(SOURCE);

        await card(gm, npc).locator(".encounter-npc-menu-btn").click();
        const menu = await card(gm, npc).locator(".encounter-npc-menu button").allTextContents();
        expect(menu).toContain("Save to collection");
        expect(menu).not.toContain("Add variant to bestiary…");
        await card(gm, npc).locator(".encounter-npc-menu-btn").click();
    });

    it("the gamemaster cannot edit the outsider's creature over the room's socket", async () => {
        await gm.clearRecords({ settle: false });
        const eventID = await gm.page.evaluate(sheetID => {
            const eventID = crypto.randomUUID();
            const msg = { type: "change", eventID, sheetID: String(sheetID), path: "characterInfo.characterName", change: JSON.stringify("Mine") };
            document.dispatchEvent(new CustomEvent("room:sendMessage", { detail: JSON.stringify(msg) }));
            return eventID;
        }, creature);
        const answer = await gm.waitReceived(m => m.type === "response" && m.eventID === eventID, "the answer to the edit");
        expect(answer.OK).toBe(false);
        const sheet = await bestiary<{ content: any; canEdit: boolean }>(gm.page, "GET", `/sheet/view/${creature}`);
        expect(sheet.content.characterInfo.characterName).toBe(KROOT);
        expect(sheet.canEdit).toBe(false);
    });

    it("made private, the collection leaves the gamemaster's list and its creature is closed to them", async () => {
        await setVisibility("private");
        expect(await listed()).toEqual([false, false]);
        // The sheet route answers 403 for any sheet the user cannot view, as for those of other rooms.
        const res = await gm.context.request.get(`${config.base}/sheet/view/${creature}`, { maxRedirects: 0 });
        expect(res.status()).toBe(403);
    });

    it("public again, it comes back to the subscriber", async () => {
        await setVisibility("public");
        expect(await listed()).toEqual([true, true]);
    });

    it("unsubscribed, it leaves the list and the catalog shows it unsubscribed", async () => {
        const page = await bestiaryPage(gm);
        try {
            await page.locator(`.bestiary-collection[data-collection-id="${collection}"]`).click();
            await page.locator(".bestiary-unsubscribe").click();
            await eventually(() => section(page, "subscribed"), names => expect(names).not.toContain(LISTED));

            await page.locator(".bestiary-catalog-link").click();
            await page.locator(".bestiary-catalog-search").fill(XENOS);
            const subscribe = page.locator(`.bestiary-catalog-table tr[data-collection-id="${collection}"] .bestiary-catalog-subscribe`);
            await eventually(() => subscribe.textContent(), t => expect(t).toBe("Subscribe"));
        } finally {
            await page.close();
        }
        expect(await listed()).toEqual([false, false]);
    });
});
