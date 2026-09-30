// GM mode is the gamemaster's alone: the moderator and the players have no
// switch, and the server gives them neither the encounter nor its NPCs.
// Runs on the seeded room: `npm run seed`. Acceptance checklist, item 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seed } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { deleteEncounter, enterGmMode, newEncounter, newNpc } from "../../lib/encounter";

describe("GM mode", () => {
    let browser: Browser;
    let gm: Player;
    let moderator: Player;
    let player: Player;
    let encounter = 0;
    let npc = 0;
    const room = () => seed().roomId;

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        moderator = await Player.create(browser, "moderator", { role: "moderator" });
        player = await Player.create(browser, "player", { role: "player" });
        await gm.openRoom(room());
        await enterGmMode(gm);
        encounter = await newEncounter(gm);
        npc = await newNpc(gm);
        await moderator.openRoom(room());
        await player.openRoom(room());
    });

    afterAll(async () => {
        try {
            if (gm && encounter) await deleteEncounter(gm, encounter);
        } finally {
            await browser?.close();
        }
    });

    it("is switched on by the gamemaster only", async () => {
        expect(await gm.page.locator(".gm-mode-btn").count()).toBe(1);
        for (const p of [moderator, player]) {
            expect(await p.page.locator(".gm-mode-btn").count(), p.name).toBe(0);
            expect(await p.page.locator(".encounter-window").count(), p.name).toBe(0);
            // Everyone has the initiative window.
            expect(await p.page.locator(".initiative-btn").count(), p.name).toBe(1);
        }
        expectNoErrors([gm, moderator, player]);
    });

    it("keeps the encounter and its NPCs from everyone else", async () => {
        const status = async (p: Player, path: string) => (await p.context.request.get(`${p.base}${path}`)).status();
        expect(await status(gm, `/encounter/${encounter}`)).toBe(200);
        expect(await status(gm, `/sheet/view/${npc}`)).toBe(200);
        for (const p of [moderator, player]) {
            expect(await status(p, `/encounter/${encounter}`), p.name).toBe(403);
            expect(await status(p, `/sheet/view/${npc}`), p.name).toBe(403);
        }
    });

    it("refuses the encounter messages of the others", async () => {
        await moderator.clearRecords({ settle: false });
        await moderator.page.evaluate(id => document.dispatchEvent(new CustomEvent("room:sendMessage", {
            detail: JSON.stringify({ type: "encounterNext", eventID: "e2e-next", encounterId: id }),
        })), encounter);
        const answer = await moderator.waitReceived(m => m.type === "response" && m.eventID === "e2e-next", "the answer");
        expect(answer).toMatchObject({ OK: false, code: "permission" });
    });
});
