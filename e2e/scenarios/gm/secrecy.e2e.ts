// What the players learn of an NPC is what the gamemaster shows them: its
// name for the players in the initiative window and in its rolls, nothing of
// its sheet and its wounds, and not its real name, in the window, the chat or
// the WebSocket traffic. Runs on the seeded room: `npm run seed`. Acceptance
// checklist, items 9–11.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import type { Msg } from "../../lib/probes";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import {
    addSheets, card, closePopup, deleteEncounter, enterGmMode, initiativeWindow, newEncounter, newNpc, openInitiativeWindow,
    openPopup, renameSheet, setDisplayName, showToPlayers,
} from "../../lib/encounter";

const REAL = "e2e Secret Cultist";
const SHOWN = "e2e Shadow";

describe("an NPC with a name for the players", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;
    let encounter = 0;
    let npc = 0;
    const room = () => seed().roomId;
    const ofNpc = (m: Msg) => [m.sheetID, m.sheetId].some(id => id !== undefined && String(id) === String(npc));

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        player = await Player.create(browser, "player", { role: "player" });
        await player.openRoom(room());
        await gm.openRoom(room());
        await enterGmMode(gm);
        encounter = await newEncounter(gm);
        await addSheets(gm, [seedUser("player").sheetId!]);
        npc = await newNpc(gm);
        await renameSheet(gm, npc, REAL);
        await setDisplayName(gm, npc, SHOWN);
        await showToPlayers(gm);
        await openInitiativeWindow(player);
    });

    afterEach(() => expectNoErrors([gm, player]));

    afterAll(async () => {
        try {
            if (encounter) await deleteEncounter(gm, encounter);
        } finally {
            await browser?.close();
        }
    });

    it("is in the players' initiative window under that name", async () => {
        await eventually(() => initiativeWindow(player), w => expect(w.rows.map(r => r[0])).toContain(SHOWN));
        expect((await initiativeWindow(player)).rows.map(r => r[0])).not.toContain(REAL);
    });

    it("rolls from its sheet to the chat under that name", async () => {
        await player.clearRecords({ settle: false });
        await openPopup(gm, npc);
        await gm.page.locator("#popup-sheet label.rollable").first().click();
        const roll = await player.waitReceived(m => m.type === "chatMessage" && String(m.messageBody).startsWith("/r d100 vs"), "the NPC's roll");
        expect(roll.characterName).toBe(SHOWN);
        await closePopup(gm);
    });

    it("is rolled for under that name", async () => {
        await player.clearRecords({ settle: false });
        await gm.page.locator(".encounter-roll-npcs").click();
        const roll = await player.waitReceived(m => m.type === "chatMessage" && m.messageBody === "Initiative", "the roll for the NPCs");
        expect(String(roll.commandResult)).toMatch(new RegExp(`^${SHOWN}: .* = \\d+$`));
    });

    it("keeps its edits, wounds and real name out of the players' traffic", async () => {
        await card(gm, npc).locator(".encounter-wounds-minus").click();
        await gm.waitSent(m => ofNpc(m) && m.path === "armour.woundsCur", "the wound");
        await renameSheet(gm, npc, `${REAL} 2`);
        // The gamemaster's client publishes the order with the NPC's name for the players.
        await player.page.waitForTimeout(1000);

        const received = await player.received();
        expect(received.filter(ofNpc)).toEqual([]);
        expect(JSON.stringify(received)).not.toContain(REAL);
        expect(received.some(m => m.type === "initiativeView")).toBe(true);
        expect(await player.page.locator("#chat").textContent()).not.toContain(REAL);
        expect(await player.page.locator("#characters").textContent()).not.toContain(REAL);
    });
});
