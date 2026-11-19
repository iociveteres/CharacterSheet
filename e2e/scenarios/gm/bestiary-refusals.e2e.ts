// What the bestiary page tells a user it refuses another user's collection,
// without its wording: the address of a private collection, and a public
// one made private while it is open. The outsider sets the collection up
// through the API; the gamemaster does what a user does. Runs on the seeded
// room: `npm run seed`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { config } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { eventually } from "../../lib/wait";
import { bestiary, deleteCollections, uploadCreature, type Collection } from "../../lib/bestiary";

const PREFIX = "e2e Refusals";
const CREATURE = "e2e Refused";

describe("bestiary refusals", () => {
    let browser: Browser;
    let gm: Player;
    let outsider: Player;
    let page: Page;
    let collection = 0;

    const toasts = () => page.locator(".toasts > .toast").allTextContents();
    const view = () => page.locator(".bestiary-collection-view");

    async function setVisibility(visibility: "private" | "public"): Promise<void> {
        await bestiary(outsider.page, "PATCH", `/bestiary/collections/${collection}`, { visibility });
    }

    /** Opens the bestiary page at the address of the outsider's collection, as a link to it does. */
    async function openByAddress(): Promise<void> {
        await page.goto(`${config.base}/bestiary?collection=${collection}`);
        await page.locator(".bestiary-collection-view").waitFor();
    }

    /** Waits for one notice with text on the freshly opened page. */
    async function expectOneNotice(): Promise<void> {
        await eventually(toasts, all => {
            expect(all, "notices").toHaveLength(1);
            expect(all[0].trim(), "the notice").not.toBe("");
        });
    }

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        outsider = await Player.create(browser, "outsider", { role: "outsider" });
        await outsider.page.goto(`${config.base}/bestiary`);
        await deleteCollections(outsider.page, PREFIX);
        collection = (await bestiary<Collection>(outsider.page, "POST", "/bestiary/collections", { name: PREFIX })).id;
        await uploadCreature(outsider.page, collection, CREATURE);
        page = await gm.context.newPage();
    });

    afterAll(async () => {
        try {
            if (outsider) await deleteCollections(outsider.page, PREFIX);
        } finally {
            await browser?.close();
        }
    });

    it("the address of another user's private collection opens the user's own, with a notice", async () => {
        await openByAddress();
        await expectOneNotice();
        await eventually(() => view().getAttribute("data-own"), own => expect(own, "the collection shown is the user's").toBe("true"));
        expect(new URL(page.url()).searchParams.get("collection")).not.toBe(String(collection));
    });

    it("once public it opens without a notice", async () => {
        await setVisibility("public");
        await openByAddress();
        await eventually(() => view().getAttribute("data-collection-id"), id => expect(id).toBe(String(collection)));
        expect(await view().getAttribute("data-own")).toBe("false");
        await eventually(() => page.locator(".bestiary-creature-name").allTextContents(), names => expect(names).toEqual([CREATURE]));
        expect(await toasts(), "notices").toEqual([]);
    });

    it("made private while open, the next request tells the user and goes back to their own collection", async () => {
        await setVisibility("private");
        await page.locator(".bestiary-collection-view .bestiary-search").fill("e");
        await expectOneNotice();
        await eventually(() => view().getAttribute("data-own"), own => expect(own, "the collection shown is the user's").toBe("true"));
        expect(await page.locator(`.bestiary-collections [data-collection-id="${collection}"]`).count(), "the collection in the list").toBe(0);
    });
});
