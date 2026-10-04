// The editor of the bestiary page: the gamemaster edits a creature of their
// own in its full sheet while a second tab follows, rolls from the stat block
// and the full sheet into the page's roll feed without touching the room's
// chat, renames it in the sheet and deletes it from the menu; then reads and rolls a creature
// of the outsider's public collection, which the bestiary socket refuses to
// change. Runs on the seeded room: `npm run seed`. Acceptance checklist,
// item 21.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { config, seed } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import { bestiary, deleteCollections, expectToast } from "../../lib/bestiary";

const PREFIX = "e2e Editor";
const MINE = `${PREFIX} Orks`;
const THEIRS = `${PREFIX} Xenos`;
const ORC = "e2e Editor Orc";
const BOSS = "e2e Editor Boss";
const KROOT = "e2e Editor Kroot";

/** A sheet file with a ranged attack, for the damage roll of the full sheet. */
const creatureFile = (name: string) => Buffer.from(JSON.stringify({
    sheetKind: "black_crusade",
    characterInfo: { characterName: name },
    characteristics: { WS: { value: "30" }, BS: { value: "35" } },
    rangedAttacks: { list: { items: { r1: { name: "Shoota", damage: "1d10+4" } }, layouts: { r1: { colIndex: 0, rowIndex: 0 } } } },
}));

async function openBestiary(page: Page, collection?: number): Promise<void> {
    await page.goto(`${config.base}/bestiary${collection ? `?collection=${collection}` : ""}`);
    await page.locator(".bestiary-collections .bestiary-new-collection").waitFor();
    await page.waitForFunction(() => window.__e2e.socketOpen());
}

/** Uploads a creature into the collection open on `page`; returns its id. */
async function upload(page: Page, file: string, name: string): Promise<number> {
    await page.locator('.bestiary input[type="file"]').setInputFiles({ name: file, mimeType: "application/json", buffer: creatureFile(name) });
    await expectToast(page, `${file}: 1 creature`);
    const row = page.locator(".bestiary-table tbody tr", { hasText: name });
    await row.waitFor();
    return Number(await row.getAttribute("data-creature-id"));
}

async function pick(page: Page, creature: number): Promise<void> {
    await page.locator(`.bestiary-table tr[data-creature-id="${creature}"]`).click();
    await page.locator(`#statblock-sheet[data-sheet-id="${creature}"] .stat-block`).waitFor();
}

async function openSheet(page: Page): Promise<void> {
    await page.locator(".bestiary-open-sheet").click();
    await page.locator('#popup-sheet [data-id="characterName"]').first().waitFor();
}

const names = (page: Page) => page.locator(".bestiary-creature-name").allTextContents();
const title = (page: Page) => page.locator(".bestiary-creature-view .bestiary-title").textContent();
const statValue = (page: Page, key: string) =>
    page.locator(`#statblock-sheet [data-id="characteristics"] [data-id="${key}"] [data-id="calculatedValue"]`).textContent();
const talents = (page: Page) => page.locator("#statblock-sheet .stat-chip").allTextContents();
const feed = (page: Page) => page.locator(".roll-feed-row").evaluateAll(rows => rows.map(r => ({
    name: r.querySelector(".roll-feed-name")?.textContent ?? "",
    body: r.querySelector(".message-body")?.textContent ?? "",
    result: r.querySelector(".command-result")?.textContent ?? "",
})));

/** The editable fields of the full sheet open on `page`; the nav tabs are radios too, without a data-id. */
const editableFields = (page: Page) => page.locator("#popup-sheet").evaluate(host =>
    [...host.shadowRoot!.querySelectorAll<HTMLInputElement>("input[data-id], textarea[data-id], select[data-id]")]
        .filter(f => !f.readOnly && !f.disabled).length);

describe("the bestiary editor", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;
    let outsider: Player;
    let other: Page;
    let mine = 0;
    let orc = 0;
    let theirs = 0;
    let kroot = 0;
    let talent = "";

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        player = await Player.create(browser, "player", { role: "player" });
        outsider = await Player.create(browser, "outsider", { role: "outsider" });
        await player.openRoom(seed().roomId);
        await openBestiary(gm.page);
        await openBestiary(outsider.page);
        // What a failed run left.
        await deleteCollections(gm.page, PREFIX);
        await deleteCollections(outsider.page, PREFIX);

        mine = (await bestiary<{ id: number }>(gm.page, "POST", "/bestiary/collections", { name: MINE })).id;
        await openBestiary(gm.page, mine);
        orc = await upload(gm.page, "orc.json", ORC);
        other = await gm.context.newPage();
        await openBestiary(other, mine);
        await pick(gm.page, orc);
        await pick(other, orc);
        await player.clearRecords({ settle: false });
    });

    afterEach(() => expectNoErrors([gm, player, outsider]));

    afterAll(async () => {
        try {
            await deleteCollections(gm.page, PREFIX);
            await deleteCollections(outsider.page, PREFIX);
        } finally {
            await browser?.close();
        }
    });

    it("edits in the full sheet reach the other tab without a reload and are stored", async () => {
        const page = gm.page;
        await openSheet(page);
        expect(await editableFields(page)).toBeGreaterThan(0);

        await page.locator("#popup-sheet .characteristics .char-dropdown-toggle").click();
        await page.locator('#popup-sheet .characteristics-dropdown [data-id="WS"] [data-id="value"]').fill("45");
        await eventually(() => statValue(other, "WS"), v => expect(v).toBe("45"));

        await page.locator('#popup-sheet label.tablabel:text-is("Talents")').click();
        await page.locator('#popup-sheet [data-id="talents.list.items"] .add-button').first().click();
        await page.locator('#popup-sheet [data-id="talents.list.items"] [data-id="name"]').first().pressSequentially("Comb");
        const option = page.locator("#popup-sheet .autocomplete-dropdown .autocomplete-option").first();
        await option.waitFor();
        await option.click();
        talent = await eventually(() => page.locator('#popup-sheet [data-id="talents.list.items"] [data-id="name"]').first().inputValue(),
            name => expect(name).not.toBe("Comb"));
        await eventually(() => talents(other), chips => expect(chips).toContain(talent));

        await page.locator('#popup-sheet label.tablabel:text-is("Player Sheet")').click();
        await page.locator('#popup-sheet [data-id="characterName"]').first().fill(BOSS);
        // The tab that typed it shows it at once; the other one once the socket brings it.
        expect(await names(page)).toEqual([BOSS]);
        expect(await title(page)).toBe(BOSS);
        await eventually(() => names(other), list => expect(list).toEqual([BOSS]));
        await eventually(() => title(other), t => expect(t).toBe(BOSS));

        await page.locator(".sheet-popup-close").click();
        await page.locator(".sheet-popup").waitFor({ state: "detached" });
        await eventually(() => bestiary<{ content: any }>(page, "GET", `/sheet/view/${orc}`), ({ content }) => {
            expect(content.characterInfo.characterName).toBe(BOSS);
            expect(content.characteristics.WS.value).toBe("45");
            expect(Object.values(content.talents.list.items).map((t: any) => t.name)).toContain(talent);
        });
        await other.reload();
        await other.locator(".bestiary-collections .bestiary-new-collection").waitFor();
        await pick(other, orc);
        expect(await statValue(other, "WS")).toBe("45");
        expect(await talents(other)).toContain(talent);
        expect(await title(other)).toBe(BOSS);
    });

    it("rolls from the stat block and the full sheet go to the feed and nowhere else", async () => {
        const page = gm.page;
        await page.locator('#statblock-sheet [data-id="BS"].rollable').click();
        await eventually(() => feed(page), rows => expect(rows).toHaveLength(1));
        // The click on a roll does not open the full sheet.
        expect(await page.locator(".sheet-popup").count()).toBe(0);

        await openSheet(page);
        await page.locator('#popup-sheet label.tablabel:text-is("Combat")').click();
        await page.locator('#popup-sheet [data-id="r1"] label.rollable', { hasText: "Damage" }).click();
        const rows = await eventually(() => feed(page), rows => expect(rows).toHaveLength(2));
        expect(rows[0]).toMatchObject({ name: BOSS, body: "/r d100 vs 35\n>> Ballistic Skill" });
        expect(rows[0].result).toMatch(/^d100 vs 35:\n\d+, \d+ (success|fail)/);
        expect(rows[1]).toMatchObject({ name: BOSS, body: "/r 1d10+4\n>> Shoota" });
        expect(rows[1].result).toMatch(/^1d10\+4:\n\d+ \+ 4 = \d+$/);
        await page.locator(".sheet-popup-close").click();

        // The other tab, the room's chat and the room's socket hear nothing of them.
        expect(await other.locator(".roll-feed").count()).toBe(0);
        expect(await player.received("chatMessage")).toEqual([]);
        expect((await player.received()).filter(m => String(m.sheetID) === String(orc))).toEqual([]);
    });

    it("a delete closes the open full sheet of the other tab", async () => {
        await openSheet(other);
        const page = gm.page;

        await page.locator(".bestiary-creature-menu .bestiary-menu-btn").click();
        await page.getByRole("menuitem", { name: "Delete" }).click();
        await page.locator(".bestiary-confirm-ok").click();
        await other.locator(".sheet-popup").waitFor({ state: "detached" });
        await eventually(() => names(other), list => expect(list).toEqual([]));
        expect(await other.locator(".bestiary-creature-view").count()).toBe(0);
    });

    it("another user's creature opens read-only, rolls, and cannot be changed over the socket", async () => {
        theirs = (await bestiary<{ id: number }>(outsider.page, "POST", "/bestiary/collections", { name: THEIRS })).id;
        await openBestiary(outsider.page, theirs);
        kroot = await upload(outsider.page, "kroot.json", KROOT);
        await bestiary(outsider.page, "PATCH", `/bestiary/collections/${theirs}`, { visibility: "public" });
        await outsider.clearRecords({ settle: false });

        const page = gm.page;
        await page.locator(".bestiary-catalog-link").click();
        await page.locator(".bestiary-catalog-search").fill(THEIRS);
        await page.locator(`.bestiary-catalog-table tr[data-collection-id="${theirs}"]`).click();
        await pick(page, kroot);
        expect(await page.locator(".bestiary-open-sheet").textContent()).toBe("View");
        await openSheet(page);
        expect(await editableFields(page)).toBe(0);

        const before = (await feed(page)).length;
        await page.locator('#popup-sheet .main-characteristics [data-id="WS"] label.rollable').click();
        const rows = await eventually(() => feed(page), rows => expect(rows).toHaveLength(before + 1));
        expect(rows.at(-1)).toMatchObject({ name: KROOT, body: "/r d100 vs 30\n>> Weapon Skill" });
        await page.locator(".sheet-popup-close").click();

        await gm.clearRecords({ settle: false });
        const eventID = await page.evaluate(sheetID => {
            const eventID = crypto.randomUUID();
            const msg = { type: "change", eventID, sheetID: String(sheetID), path: "characterInfo.characterName", change: "Mine" };
            document.dispatchEvent(new CustomEvent("room:sendMessage", { detail: JSON.stringify(msg) }));
            return eventID;
        }, kroot);
        const answer = await gm.waitReceived(m => m.type === "response" && m.eventID === eventID, "the answer to the edit");
        expect(answer.OK).toBe(false);
        expect(await outsider.received("change")).toEqual([]);
        const sheet = await bestiary<{ content: any }>(outsider.page, "GET", `/sheet/view/${kroot}`);
        expect(sheet.content.characterInfo.characterName).toBe(KROOT);
    });
});
