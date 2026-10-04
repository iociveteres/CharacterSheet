// The party of a room: its characters are in every encounter, each in the
// column it was dragged to, while the NPCs, the notes and the removals with
// "Undo" are an encounter's own. Monsters come from the tab "Add monsters".
//
// Needs the seeded room (`npm run seed`): its gamemaster and a player.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import { bestiary, deleteCollections, uploadCreature } from "../../lib/bestiary";
import {
    addSheets, card, clearParty, column, columnSheets, deleteEncounter, dragToColumn, enterGmMode, gmOrder, group, initiativeWindow,
    newEncounter, newNpc, openInitiativeWindow, openTab, pickEncounter, removeNpc, resetInitiative, showToPlayers, typeInitiative,
} from "../../lib/encounter";

const PREFIX = "e2e party";
const COLLECTION = `${PREFIX} Beasts`;
const BEAST = `${PREFIX} Squig`;
const NOTES = `${PREFIX}: the ambush starts at the bridge`;

describe("the party of a room", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;
    let a = 0;
    let b = 0;
    let npc = 0;
    let collection = 0;
    let creature = 0;
    const room = () => seed().roomId;
    const mine = () => seedUser("player").sheetId!;
    const theirs = () => seedUser("player2").sheetId!;
    const gms = () => seedUser("gm").sheetId!;

    /** Reloads the gamemaster's room and opens encounter `id` again. */
    async function reload(id: number): Promise<void> {
        await gm.openRoom(room());
        await enterGmMode(gm);
        await pickEncounter(gm, id);
    }

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        player = await Player.create(browser, "player", { role: "player" });
        await player.openRoom(room());
        await gm.openRoom(room());
        await deleteCollections(gm.page, PREFIX);
        await enterGmMode(gm);
        // What a failed run left: the scenario counts on its own characters only.
        await clearParty(gm);

        collection = (await bestiary<{ id: number }>(gm.page, "POST", "/bestiary/collections", { name: COLLECTION })).id;
        creature = await uploadCreature(gm.page, collection, BEAST, mine());
    });

    afterEach(() => expectNoErrors([gm, player]));

    afterAll(async () => {
        try {
            if (gm) await clearParty(gm);
            for (const id of [a, b]) if (id) await deleteEncounter(gm, id);
            if (gm) await deleteCollections(gm.page, PREFIX);
        } finally {
            await browser?.close();
        }
    });

    it("has the player's sheet added in one encounter in the Party of a new one", async () => {
        a = await newEncounter(gm);
        await addSheets(gm, [mine()]);
        b = await newEncounter(gm);
        await eventually(() => columnSheets(gm, "party"), ids => expect(ids).toEqual([mine()]));
        expect(await columnSheets(gm, "enemies")).toEqual([]);
    });

    it("keeps the columns the cards are dragged to, the character's in every encounter", async () => {
        await pickEncounter(gm, a);
        npc = await newNpc(gm);
        await dragToColumn(gm, npc, "party");
        await dragToColumn(gm, mine(), "enemies");

        await reload(a);
        await eventually(() => columnSheets(gm, "party"), ids => expect(ids).toEqual([npc]));
        expect(await columnSheets(gm, "enemies")).toEqual([mine()]);

        await pickEncounter(gm, b);
        await eventually(() => columnSheets(gm, "enemies"), ids => expect(ids).toEqual([mine()]));
        expect(await columnSheets(gm, "party")).toEqual([]);
    });

    it("has a group of two characters of the room in both encounters", async () => {
        await addSheets(gm, [gms(), theirs()]);
        await group(gm, "party", [gms(), theirs()]);
        await pickEncounter(gm, a);
        const together = () => card(gm, gms()).evaluate(el => Array.from(el.closest(".encounter-group-frame")?.querySelectorAll(".encounter-card") ?? [])
            .map(c => Number((c as HTMLElement).dataset.sheetId)).sort((x, y) => x - y));
        await eventually(together, ids => expect(ids).toEqual([gms(), theirs()].sort((x, y) => x - y)));
        expect(await columnSheets(gm, "party")).toContain(npc);
    });

    it("keeps the notes of an encounter, which the players do not get", async () => {
        await player.clearRecords({ settle: false });
        const sent = (await gm.sent("encounterDescribe")).length;
        await gm.page.locator(".encounter-notes").fill(NOTES);
        const [stored] = (await eventually(() => gm.sent("encounterDescribe"), all => expect(all.length).toBeGreaterThan(sent))).slice(-1);
        await gm.waitReceived(m => m.eventID === stored.eventID, "the stored notes");

        await reload(a);
        expect(await gm.page.locator(".encounter-notes").inputValue()).toBe(NOTES);
        await pickEncounter(gm, b);
        expect(await gm.page.locator(".encounter-notes").inputValue()).toBe("");
        expect(JSON.stringify(await player.received())).not.toContain(NOTES);
        await pickEncounter(gm, a);
    });

    it("brings a removed NPC back with Undo, for good", async () => {
        const sent = (await gm.sent("encounterRemove")).length;
        await removeNpc(gm, npc, { undo: true });
        // Past the 5 s the removal would have waited.
        await gm.page.waitForTimeout(5500);
        expect(await gm.sent("encounterRemove")).toHaveLength(sent);
        await reload(a);
        await card(gm, npc).waitFor();
    });

    it("deletes a removed NPC and its sheet 5 s later without Undo", async () => {
        await removeNpc(gm, npc);
        expect(await card(gm, npc).count()).toBe(0);
        const status = (await gm.context.request.get(`${gm.base}/sheet/view/${npc}`)).status();
        expect(status).toBe(404);
        npc = 0;
    });

    it("previews a creature of the gamemaster's collection without rolls and adds it twice to the Enemies", async () => {
        await openTab(gm, "monsters");
        await gm.page.locator(`.encounter-collection[data-collection-id="${collection}"]`).click();
        await gm.page.locator(`.encounter-creature[data-creature-id="${creature}"]`).click();
        const preview = gm.page.locator(`.statblock-preview[data-creature-id="${creature}"]`);
        expect(await preview.locator(".statblock-name").textContent()).toBe(BEAST);
        await gm.page.locator('#statblock-sheet .stat-block [data-id="WS"]').waitFor();
        expect(await gm.page.locator("#statblock-sheet .rollable").count()).toBe(0);

        const add = gm.page.locator(`.encounter-creature[data-creature-id="${creature}"] .encounter-add-creature`);
        await add.click();
        await add.click();
        await openTab(gm, "combat");
        const titles = column(gm, "enemies").locator(".encounter-card-title");
        await eventually(() => titles.allTextContents(), names => expect(names.filter(n => n.startsWith(BEAST)).sort()).toEqual([`${BEAST} 1`, `${BEAST} 2`]));
    });

    it("resets the initiative from its column without a confirm", async () => {
        await typeInitiative(gm, 0, 12);
        await eventually(() => gmOrder(gm), rows => expect(rows.map(r => r[1])).toContain("12"));
        await resetInitiative(gm);
        await eventually(() => gmOrder(gm), rows => expect(rows.every(r => r[1] === "—")).toBe(true));
        expect(await gm.page.locator("#confirm-modal").isVisible()).toBe(false);
    });

    it("shows the order to the players from its column", async () => {
        await showToPlayers(gm);
        await openInitiativeWindow(player);
        const order = (await gmOrder(gm)).map(r => r[0].replace(/^\*/, ""));
        expect(order.length).toBeGreaterThan(1);
        await eventually(() => initiativeWindow(player), w => expect(w.rows.map(r => r[0].replace(/^\*/, ""))).toEqual(order));
    });
});
