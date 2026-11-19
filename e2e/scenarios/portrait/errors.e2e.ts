// Portrait errors are shown under the portrait, without their wording: a
// dropped file that is not an image, and a delete and an upload the server
// refuses. The refusals are real: the player edits the gamemaster's shared
// sheet, and the gamemaster takes the rights away while the news is held
// back from the player's page. Runs on the seeded room (`npm run seed`).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Locator, Request } from "playwright-core";
import { seed } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { dropFile, hashOf, pickFile, pngFile, textFile, type FilePayload } from "../../lib/portrait";
import { createSheet, deleteSheet, expectNoErrors, setVisibility } from "../../lib/table";
import { eventually, sleep } from "../../lib/wait";

describe("portrait errors", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;
    let sheet = 0;
    let image: FilePayload;
    let holdVisibility = false;
    /** The portrait requests of the player's page and their answers. */
    const requests: Request[] = [];

    const cell = (p: Player): Locator => p.page.locator("#charactersheet .portrait-cell");
    const img = (p: Player): Locator => cell(p).locator(".portrait > img");
    const pop = (p: Player): Locator => cell(p).locator(".crop-pop");
    const error = (p: Player): Locator => cell(p).locator(".portrait-error");
    const sent = (method: string) => requests.filter(r => r.method() === method);

    /** Waits for the error under the frame and returns its text, which must not be empty. */
    async function shownError(p: Player): Promise<string> {
        return eventually(async () => (await error(p).count()) ? (await error(p).textContent())!.trim() : "",
            text => expect(text, `${p.name}: the error under the portrait`).not.toBe(""));
    }

    /** The status of the last answered request of `method`. */
    async function lastStatus(method: string): Promise<number> {
        const res = await eventually(async () => sent(method).at(-1)?.response() ?? null, r => expect(r, `the answer to ${method}`).not.toBeNull());
        return res!.status();
    }

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        player = await Player.create(browser, "player", { role: "player" });
        player.page.on("request", r => {
            if (r.url().includes("/sheet/portrait/")) requests.push(r);
        });
        await gm.openRoom(seed().roomId);
        sheet = await createSheet(gm);
        await setVisibility(gm, sheet, "everyone_can_edit");
        await gm.openSheet(seed().roomId, sheet);
        await player.dropIncoming("changeSheetVisibility", () => holdVisibility);
        await player.openSheet(seed().roomId, sheet);
        await gm.openNavTab("player");
        await player.openNavTab("player");
        image = await pngFile(player.page, 800, 600);
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

    it("the player may give the shared sheet a portrait", async () => {
        await pickFile(player.page, cell(player).locator(".portrait.empty"), image);
        await pop(player).locator(".crop-save:enabled").click();
        await pop(player).waitFor({ state: "detached" });
        expect(await lastStatus("PUT")).toBe(204);
        await eventually(() => img(gm).getAttribute("src"), src => expect(src, "the gm's portrait").toMatch(/^\/portrait\//));
    });

    it("a dropped file that is not an image is reported under the frame, and nothing is sent", async () => {
        const hash = await hashOf(img(player));
        const puts = sent("PUT").length;
        await dropFile(cell(player).locator(".portrait"), textFile());
        await shownError(player);
        expect(await pop(player).count(), "the portrait window").toBe(0);
        expect(sent("PUT")).toHaveLength(puts);
        expect(await hashOf(img(player))).toBe(hash);

        // The next image clears it.
        await dropFile(cell(player).locator(".portrait"), image);
        await pop(player).locator(".crop-save:enabled").waitFor();
        expect(await error(player).count(), "the error once an image is dropped").toBe(0);
        await pop(player).locator(".crop-cancel").click();
        await pop(player).waitFor({ state: "detached" });
    });

    it("a delete the server refuses keeps the portrait with the reason under it", async () => {
        holdVisibility = true;
        await setVisibility(gm, sheet, "everyone_can_view");
        // Long enough for the change to have reached the player, had it not been held.
        await sleep(300);
        const hash = await hashOf(img(player));

        await player.click({ sel: ".portrait:not(.empty)" });
        await pop(player).locator(".crop-delete").click();
        await pop(player).locator(".crop-delete-yes").click();
        await pop(player).waitFor({ state: "detached" });
        expect(await lastStatus("DELETE")).toBe(403);
        await shownError(player);
        await eventually(() => hashOf(img(player)), h => expect(h, "the player's portrait").toBe(hash));
        expect(await hashOf(img(gm)), "the gm's portrait").toBe(hash);
        // The browser reports the refused request in the console.
        expect(player.takeErrors().filter(e => !/status of 403/.test(e))).toEqual([]);
    });

    it("an upload the server refuses keeps the portrait with the reason under it", async () => {
        const hash = await hashOf(img(player));
        await player.click({ sel: ".portrait:not(.empty)" });
        await pop(player).locator(".crop-save:enabled").waitFor();
        await pop(player).locator(".crop-stage").hover();
        await player.page.mouse.wheel(0, -300);
        await pop(player).locator(".crop-save").click();
        await pop(player).waitFor({ state: "detached" });
        expect(await lastStatus("PUT")).toBe(403);
        await shownError(player);
        await eventually(() => img(player).getAttribute("src"), src => expect(src, "the player's portrait").toBe(`/portrait/${hash}`));
        expect(await cell(player).locator(".portrait.uploading").count(), "the spinner").toBe(0);
        expect(await hashOf(img(gm)), "the gm's portrait").toBe(hash);
        expect(player.takeErrors().filter(e => !/status of 403/.test(e))).toEqual([]);
    });
});
