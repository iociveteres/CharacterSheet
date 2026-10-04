// The participants of an encounter: the gamemaster's wounds buttons edit the
// sheets, a sheet deleted while its group has the turn passes the turn on, and
// an encounter deleted takes its NPCs and not the players' sheets. Runs on the
// seeded room: `npm run seed`. Acceptance checklist, items 8, 13 and 14.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { createSheet, deleteSheet, expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import { addSheets, card, clearParty, deleteEncounter, enterGmMode, gmOrder, gmRound, newEncounter, newNpc } from "../../lib/encounter";

describe("the participants of an encounter", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;
    let encounter = 0;
    let npc = 0;
    let fresh = 0;
    const room = () => seed().roomId;
    const mine = () => seedUser("player").sheetId!;

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        player = await Player.create(browser, "player", { role: "player" });
        await gm.openRoom(room());
        await enterGmMode(gm);
        encounter = await newEncounter(gm);
        await clearParty(gm);
        await addSheets(gm, [mine()]);
        npc = await newNpc(gm);
        await player.openSheet(room(), mine());
    });

    afterEach(() => expectNoErrors([gm, player]));

    afterAll(async () => {
        try {
            if (fresh) await deleteSheet(player, fresh);
            if (gm) await clearParty(gm);
            if (encounter) await deleteEncounter(gm, encounter);
        } finally {
            await browser?.close();
        }
    });

    it("wound the player's sheet with the gamemaster's buttons, and heal it", async () => {
        await player.openNavTab("combat");
        const taken = Number(await player.read("armour.woundsCur")) || 0;
        await card(gm, mine()).locator(".encounter-wounds-minus").click();
        await player.expectValue("armour.woundsCur", String(taken + 1));
        await card(gm, mine()).locator(".encounter-wounds-plus").click();
        await player.expectValue("armour.woundsCur", String(taken));
    });

    it("pass the turn on when a player deletes the sheet whose group has it", async () => {
        fresh = await createSheet(player);
        await addSheets(gm, [fresh]);
        const name = await card(gm, fresh).locator(".encounter-card-title").textContent();
        const rows = await eventually(() => gmOrder(gm), rows => expect(rows).toHaveLength(3));
        const at = rows.findIndex(r => r[0] === name);
        for (let i = 0; i <= at; i++) await gm.page.locator(".encounter-next").click();
        await eventually(() => gmOrder(gm), rows => expect(rows[at][0]).toBe(`*${name}`));
        const round = await gmRound(gm);

        const deleted = fresh;
        await deleteSheet(player, deleted);
        fresh = 0;
        await card(gm, deleted).waitFor({ state: "detached" });
        const after = await eventually(() => gmOrder(gm), rows => expect(rows).toHaveLength(2));
        // The next group has the turn, after the last one the first in the next round.
        const next = at < after.length ? at : 0;
        expect(after[next][0]).toBe(`*${rows[at < after.length ? at + 1 : 0][0]}`);
        expect(await gmRound(gm)).toBe(at < after.length ? round : round + 1);
    });

    it("go with a deleted encounter when they are NPCs, and the players' sheets stay", async () => {
        const status = async (path: string) => (await gm.context.request.get(`${gm.base}${path}`)).status();
        expect(await status(`/sheet/view/${npc}`)).toBe(200);
        await deleteEncounter(gm, encounter);
        encounter = 0;
        expect(await status(`/sheet/view/${npc}`)).toBe(404);
        expect(await status(`/sheet/view/${mine()}`)).toBe(200);
        await gm.page.locator(".encounter-none").waitFor();
    });
});
