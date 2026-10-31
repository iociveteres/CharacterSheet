// The portrait of a room's sheet: its owner adds it from a file, crops it in
// the portrait window and saves, replaces and deletes it, while a player who
// may only view the sheet sees each change without a reload. Runs on the
// seeded room (`npm run seed`) on a fresh sheet of the gamemaster, shown to
// everyone: deleting it at the end takes its portrait with it.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator, Request } from "playwright-core";
import { seed } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { dropFile, hashOf, pickFile, pngFile, servedSize, textFile, type FilePayload } from "../../lib/portrait";
import { createSheet, deleteSheet, expectNoErrors, setVisibility } from "../../lib/table";
import { eventually, sleep } from "../../lib/wait";

const NOT_AN_IMAGE = "Not an image: choose a PNG, JPEG or WebP file.";

describe("the portrait of a room's sheet", () => {
    let browser: Browser;
    let owner: Player;
    let viewer: Player;
    let sheet = 0;
    let image: FilePayload;
    /** The portrait requests of the owner's page: PUT and DELETE /sheet/portrait/:id. */
    const requests: Request[] = [];

    const cell = (p: Player): Locator => p.page.locator("#charactersheet .portrait-cell");
    const img = (p: Player): Locator => cell(p).locator(".portrait > img");
    const pop = (p: Player): Locator => cell(p).locator(".crop-pop");
    const sent = (method: string) => requests.filter(r => r.method() === method);

    /** Opens the portrait window on the saved portrait with a click on it, and waits until it can be saved. */
    async function openWindow(): Promise<void> {
        await owner.click({ sel: ".portrait:not(.empty)" });
        await pop(owner).locator(".crop-save:enabled").waitFor();
    }

    async function closeWindow(): Promise<void> {
        await pop(owner).locator(".crop-cancel").click();
        await pop(owner).waitFor({ state: "detached" });
    }

    /** Waits until both players show the portrait of `hash`, as served, at its stored size. */
    async function expectShown(hash: string): Promise<void> {
        for (const p of [owner, viewer]) {
            await eventually(() => img(p).getAttribute("src"), src => expect(src, `${p.name}: the portrait`).toBe(`/portrait/${hash}`));
            expect(await servedSize(img(p)), `${p.name}: the served size`).toEqual({ width: 360, height: 480 });
        }
    }

    /** Saves the window and returns the hash portraitChanged brings to the viewer. */
    async function saveAndWait(): Promise<string> {
        const before = (await viewer.received("portraitChanged")).length;
        const puts = sent("PUT").length;
        await pop(owner).locator(".crop-save").click();
        await pop(owner).waitFor({ state: "detached" });
        await eventually(async () => sent("PUT").length, n => expect(n, "PUT requests").toBe(puts + 1));
        const changes = await eventually(() => viewer.received("portraitChanged"), all => expect(all.length, "portraitChanged").toBe(before + 1));
        const { sheetID, portrait } = changes.at(-1)!;
        expect(sheetID).toBe(String(sheet));
        // Playwright does not show a Blob body: what was stored is what is served.
        const res = await owner.context.request.get(`${owner.base}/portrait/${portrait}`);
        expect(res.headers()["content-type"], "the stored image").toBe("image/webp");
        expect(res.headers()["cache-control"]).toBe("private, max-age=31536000, immutable");
        return portrait;
    }

    beforeAll(async () => {
        browser = await launch();
        owner = await Player.create(browser, "owner", { role: "gm" });
        viewer = await Player.create(browser, "viewer", { role: "player" });
        owner.page.on("request", r => {
            if (r.url().includes("/sheet/portrait/")) requests.push(r);
        });
        await owner.openRoom(seed().roomId);
        sheet = await createSheet(owner);
        await setVisibility(owner, sheet, "everyone_can_view");
        await owner.openSheet(seed().roomId, sheet);
        await viewer.openSheet(seed().roomId, sheet);
        await owner.openNavTab("player");
        await viewer.openNavTab("player");
        image = await pngFile(owner.page, 800, 600);
    });

    afterEach(() => expectNoErrors([owner, viewer]));

    afterAll(async () => {
        try {
            if (sheet) {
                await owner.openRoom(seed().roomId);
                await deleteSheet(owner, sheet);
            }
        } finally {
            await browser?.close();
        }
    });

    it("offers the owner an empty frame and shows a viewer nothing", async () => {
        expect((await viewer.sheetState()).canEdit, "the viewer may not edit").toBe(false);
        expect(await cell(owner).locator(".portrait.empty").textContent()).toBe("+ Portrait");
        expect(await cell(viewer).count(), "the viewer's portrait cell").toBe(0);
    });

    it("crops a picked file and saves it: the viewer sees it without a reload", async () => {
        const inserted = await viewer.page.evaluate(() => window.__e2e.inserted);
        // The empty frame opens the file picker at once; the window comes with the image in it.
        await pickFile(owner.page, cell(owner).locator(".portrait.empty"), image);
        await pop(owner).locator(".crop-save:enabled").waitFor();
        expect(await pop(owner).locator(".crop-delete").count(), "no Delete for a new portrait").toBe(0);

        const stage = await pop(owner).locator(".crop-stage").boundingBox();
        const x = stage!.x + stage!.width / 2, y = stage!.y + stage!.height / 2;
        await owner.page.mouse.move(x, y);
        await owner.page.mouse.down();
        await owner.page.mouse.move(x + 40, y + 10, { steps: 5 });
        await owner.page.mouse.up();
        await owner.page.mouse.wheel(0, -300);
        await eventually(() => pop(owner).locator(".crop-zoom input").inputValue(), zoom => expect(Number(zoom), "the zoom").toBeGreaterThan(1));

        const hash = await saveAndWait();
        await expectShown(hash);
        expect(await viewer.page.evaluate(() => window.__e2e.inserted), "the viewer's sheet was not rendered again").toBe(inserted);
        expect((await viewer.sheetState()).portrait).toBe(hash);
    });

    it("shows a viewer the full size, but no Edit and no window", async () => {
        const frame = cell(viewer).locator(".portrait");
        expect(await frame.getAttribute("role")).toBeNull();
        expect(await frame.locator(".edit-strip").count()).toBe(0);
        await viewer.click({ sel: ".portrait" });
        expect(await cell(viewer).locator(".crop-pop").count(), "the viewer's portrait window").toBe(0);

        await viewer.click({ sel: ".portrait-full-open" });
        const full = viewer.page.locator("#charactersheet .portrait-full img");
        expect(await servedSize(full)).toEqual({ width: 360, height: 480 });
        await viewer.page.keyboard.press("Escape");
        await viewer.page.locator("#charactersheet .portrait-full").waitFor({ state: "detached" });
    });

    it("sends nothing when the saved portrait is saved with its crop untouched", async () => {
        const hash = await hashOf(img(owner));
        const puts = sent("PUT").length;
        await openWindow();
        await pop(owner).locator(".crop-save").click();
        await pop(owner).waitFor({ state: "detached" });
        // Long enough for an encode and a request to start.
        await sleep(500);
        expect(sent("PUT").length, "PUT requests").toBe(puts);
        expect(await hashOf(img(owner))).toBe(hash);

        // A new crop of the saved portrait is an image of its own.
        await openWindow();
        await pop(owner).locator(".crop-stage").hover();
        await owner.page.mouse.wheel(0, -300);
        const recropped = await saveAndWait();
        expect(recropped).not.toBe(hash);
        await expectShown(recropped);
    });

    it("reports a dropped file that is not an image under the frame and keeps the portrait", async () => {
        const hash = await hashOf(img(owner));
        const puts = sent("PUT").length;
        await dropFile(cell(owner).locator(".portrait"), textFile());
        await eventually(() => cell(owner).locator(".portrait-error").textContent(), text => expect(text).toBe(NOT_AN_IMAGE));
        expect(await pop(owner).count(), "the portrait window").toBe(0);
        expect(await hashOf(img(owner))).toBe(hash);
        expect(await hashOf(img(viewer))).toBe(hash);
        expect(sent("PUT").length).toBe(puts);
    });

    it("opens a dropped image in the window, where a file that is not one is reported", async () => {
        const hash = await hashOf(img(owner));
        await dropFile(cell(owner).locator(".portrait"), image);
        await pop(owner).locator(".crop-save:enabled").waitFor();
        expect(await cell(owner).locator(".portrait-error").count(), "the error of the last drop is gone").toBe(0);

        await pickFile(owner.page, pop(owner).locator(".crop-choose"), textFile());
        expect(await pop(owner).locator(".crop-message").textContent()).toBe(NOT_AN_IMAGE);
        // A file that calls itself an image but is none: the window cannot open it.
        await pickFile(owner.page, pop(owner).locator(".crop-choose"), { ...textFile("broken.png"), mimeType: "image/png" });
        await eventually(() => pop(owner).locator(".crop-message").textContent(), text => expect(text).toBe(NOT_AN_IMAGE));
        expect(await pop(owner).locator(".crop-save").isDisabled(), "Save without an image").toBe(true);

        await closeWindow();
        expect(await hashOf(img(owner))).toBe(hash);
    });

    it("keeps the old portrait with the reason under it when the server refuses the image", async () => {
        const hash = await hashOf(img(owner));
        await owner.page.route("**/sheet/portrait/*", route => route.request().method() === "PUT" ? route.fulfill({ status: 400 }) : route.continue());
        try {
            await openWindow();
            await pop(owner).locator(".crop-stage").hover();
            await owner.page.mouse.wheel(0, -300);
            await pop(owner).locator(".crop-save").click();
            await eventually(() => cell(owner).locator(".portrait-error").textContent(), text => expect(text).toBe("Not a 360×480 WebP or JPEG image."));
            await eventually(() => img(owner).getAttribute("src"), src => expect(src).toBe(`/portrait/${hash}`));
            expect(await cell(owner).locator(".portrait.uploading").count(), "the spinner").toBe(0);
            expect(await hashOf(img(viewer))).toBe(hash);
        } finally {
            await owner.page.unrouteAll();
        }
        // The browser reports the refused request in the console.
        expect(owner.takeErrors().filter(e => !/status of 400/.test(e))).toEqual([]);
    });

    it("deletes in the window after asking there: Keep keeps it, Delete removes it for both", async () => {
        const hash = await hashOf(img(owner));
        await openWindow();
        await pop(owner).locator(".crop-delete").click();
        expect(await pop(owner).locator(".crop-footer .question").textContent()).toBe("Delete the portrait?");
        expect(await pop(owner).locator(".crop-save").count(), "Save while asking").toBe(0);
        await pop(owner).locator(".crop-keep").click();
        await pop(owner).locator(".crop-delete").waitFor();
        await closeWindow();
        expect(sent("DELETE")).toHaveLength(0);
        expect(await hashOf(img(owner))).toBe(hash);

        const before = (await viewer.received("portraitChanged")).length;
        await openWindow();
        await pop(owner).locator(".crop-delete").click();
        await pop(owner).locator(".crop-delete-yes").click();
        await pop(owner).waitFor({ state: "detached" });
        const [change] = (await eventually(() => viewer.received("portraitChanged"), all => expect(all.length).toBe(before + 1))).slice(before);
        expect(change.portrait).toBeNull();
        expect(sent("DELETE")).toHaveLength(1);

        await eventually(() => cell(owner).locator(".portrait.empty").count(), n => expect(n, "the owner's empty frame").toBe(1));
        await eventually(() => cell(viewer).count(), n => expect(n, "the viewer's portrait cell").toBe(0));
        expect((await viewer.sheetState()).portrait).toBeNull();
    });
});
