// A roll from a sheet reads in the chat in each reader's language, whatever
// the roller's: the sheet sends its label as codes (sheet/rollLabel.ts), and
// every page words them with its own dictionary. The gm's pages are in
// English and the player's in Russian, by the lang cookie: neither seeded
// user has a saved language, which would win over it. It reads no wording:
// each page's chat says what the page's own sheet calls the characteristic
// or the skill rolled. Runs on the seeded room (`npm run seed`).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("the label of a sheet roll in the chat", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm", lang: "en" });
        player = await Player.create(browser, "player", { role: "player", lang: "ru" });
        await gm.openSheet(seed().roomId, seedUser("gm").sheetId!);
        await player.openSheet(seed().roomId, seedUser("player").sheetId!);
        for (const p of [gm, player]) await p.openNavTab("player");
    });

    afterEach(() => expectNoErrors([gm, player]));

    afterAll(async () => {
        await browser?.close();
    });

    /** What the sheet on the page of `p` calls the characteristic `key`: its label without the key under it. */
    const characteristicWords = async (p: Player, key: string) =>
        (await p.el({ path: `characteristics.${key}`, sel: "label.rollable" })).evaluate(el => el.firstChild?.textContent ?? "");

    /** What the skill table on the page of `p` calls the skill `key` of its left column. */
    const skillWords = async (p: Player, key: string) =>
        (await p.el({ path: `skillsLeft.${key}`, sel: ":scope > td" })).evaluate(el => el.textContent ?? "");

    const messages = (p: Player) => p.page.evaluate(() => Array.from(document.querySelectorAll("#chat .message-body"), el => el.textContent ?? ""));

    /** Runs `roll` and returns the label of the roll each page's chat shows, the ">>" line of the new message. */
    async function labelsOf(roll: () => Promise<void>): Promise<{ gm: string; player: string }> {
        const before = { gm: (await messages(gm)).length, player: (await messages(player)).length };
        await roll();
        const label = async (p: Player, from: number) => {
            const added = await eventually(async () => (await messages(p)).slice(from), m => expect(m, `${p.name}: the roll in the chat`).toHaveLength(1));
            const at = added[0].indexOf("\n>> ");
            expect(at, `${p.name}: a label under the command`).toBeGreaterThan(0);
            return added[0].slice(at + 4);
        };
        return { gm: await label(gm, before.gm), player: await label(player, before.player) };
    }

    it("of a characteristic the gm rolls is in English for the gm and in Russian for the player", async () => {
        const words = { gm: await characteristicWords(gm, "WS"), player: await characteristicWords(player, "WS") };
        expect(words.gm, "the pages are in different languages").not.toBe(words.player);
        expect(await labelsOf(() => gm.click({ path: "characteristics.WS", sel: "label.rollable" }))).toEqual(words);
    });

    it("of a skill the player rolls is in Russian for the player and in English for the gm", async () => {
        const words = { gm: await skillWords(gm, "parry"), player: await skillWords(player, "parry") };
        expect(words.gm, "the pages are in different languages").not.toBe(words.player);
        expect(await labelsOf(() => player.click("skillsLeft.parry.difficulty"))).toEqual(words);
    });
});
