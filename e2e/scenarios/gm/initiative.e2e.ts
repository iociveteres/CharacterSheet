// The turn order of an encounter: the gamemaster gathers characters and NPCs
// into groups and shows the encounter to the players; the players roll in
// their sheets, the gamemaster rolls for the NPCs or types a value, and both
// see the order and whose turn it is. Runs on the seeded room: `npm run seed`.
// Acceptance checklist, items 2–7 and 12.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import type { Msg } from "../../lib/probes";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import {
    addSheets, clearParty, deleteEncounter, enterGmMode, gmOrder, gmRound, group, initiativeWindow, newEncounter, newNpc,
    openInitiativeWindow, pickEncounter, renameSheet, resetInitiative, setDisplayName, showToPlayers, typeInitiative,
} from "../../lib/encounter";

// "d10+2:\n7 + 2 = 9", or "d10:\n7" for a roll without a modifier.
const totalOf = (m: Msg) => Number(String(m.commandResult).match(/(-?\d+)\s*$/)![1]);

describe("the initiative of an encounter", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;
    const encounters: number[] = [];
    const room = () => seed().roomId;
    const mine = () => seedUser("player").sheetId!;
    const theirs = () => seedUser("player2").sheetId!;
    const gms = () => seedUser("gm").sheetId!;
    let names: { [sheetId: number]: string } = {};
    let orcs: number[] = [];
    let figure = 0;

    const rowOf = (rows: string[][], name: string) => rows.findIndex(r => r[0].replace(/^\*/, "") === name);

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        player = await Player.create(browser, "player", { role: "player" });
        await gm.openRoom(room());
        await enterGmMode(gm);
        encounters.push(await newEncounter(gm));
        // What a failed run left: the order below counts on these three characters only.
        await clearParty(gm);
        await addSheets(gm, [mine(), theirs(), gms()]);
        orcs = [await newNpc(gm), await newNpc(gm)];
        figure = await newNpc(gm);
        await renameSheet(gm, orcs[0], "e2e Orc 1");
        await renameSheet(gm, orcs[1], "e2e Orc 2");
        await renameSheet(gm, figure, "e2e Cultist");
        await setDisplayName(gm, figure, "e2e Figure");
        // What earlier runs left in the seeded sheets.
        await resetInitiative(gm);
        names = Object.fromEntries(await gm.page.locator(".encounter-card").evaluateAll(cards => cards.map(c =>
            [Number((c as HTMLElement).dataset.sheetId), c.querySelector(".encounter-card-title")!.textContent])));

        await player.openSheet(room(), mine());
    });

    afterEach(() => expectNoErrors([gm, player]));

    afterAll(async () => {
        try {
            if (gm) await clearParty(gm);
            for (const id of encounters) await deleteEncounter(gm, id);
        } finally {
            await browser?.close();
        }
    });

    it("gathers the characters of two players and NPCs, each column in groups of its own", async () => {
        await group(gm, "enemies", orcs);
        await group(gm, "party", [theirs(), gms()]);
        const rows = await eventually(() => gmOrder(gm), rows => expect(rows).toHaveLength(4));
        expect(rows.map(r => r[1])).toEqual(["—", "—", "—", "—"]);
        expect(rows.map(r => r[0]).sort()).toEqual([
            names[mine()], "Group 2", "Group 1", "e2e Cultist",
        ].sort());
    });

    it("shows the order to the players, with the names they are given", async () => {
        await showToPlayers(gm);
        await openInitiativeWindow(player);
        const shown = await eventually(() => initiativeWindow(player), w => expect(w.rows).toHaveLength(4));
        expect(shown.title).toBe("Initiative · round 1");
        expect(shown.rows.map(r => r[0])).toContain("e2e Figure");
        expect(shown.rows.map(r => r[0])).not.toContain("e2e Cultist");
    });

    it("takes the roll a player makes in their sheet and sorts by it for both", async () => {
        await player.openNavTab("combat");
        await player.clearRecords({ settle: false });
        await player.click({ sel: ".initiative-wrapper label.rollable" });
        const roll = await player.waitReceived(m => m.type === "chatMessage" && !!m.commandResult, "the initiative roll");
        const total = totalOf(roll);

        const rows = await eventually(() => gmOrder(gm), rows => expect(rows[0]).toEqual([names[mine()], String(total)]));
        expect(rows.slice(1).map(r => r[1])).toEqual(["—", "—", "—"]);
        await eventually(() => initiativeWindow(player), w => expect(w.rows[0]).toEqual([names[mine()], String(total)]));
    });

    it("rolls for the NPCs in one chat message, a group once, under the names the players see", async () => {
        await player.clearRecords({ settle: false });
        await gm.page.locator(".encounter-roll-npcs").click();
        const message = await player.waitReceived(m => m.type === "chatMessage" && m.messageBody === "Initiative", "the roll for the NPCs");
        const lines = String(message.commandResult).split("\n");
        expect(lines).toHaveLength(2);
        expect(lines.find(l => l.startsWith("Group 1: "))).toMatch(/ = \d+$/);
        expect(lines.find(l => l.startsWith("e2e Figure: "))).toMatch(/ = \d+$/);
        expect(message.characterName ?? null).toBeNull();
        expect(JSON.stringify(await player.received())).not.toContain("e2e Cultist");

        const rows = await eventually(() => gmOrder(gm), rows => expect(rows.filter(r => r[1] === "—")).toHaveLength(1));
        // Only the group of characters that has not rolled is left.
        expect(rows.find(r => r[1] === "—")![0]).toBe("Group 2");
        await eventually(() => initiativeWindow(player), w => expect(w.rows.filter(r => r[1] === "—")).toHaveLength(1));
    });

    it("sorts by a value the gamemaster types, for both", async () => {
        const label = "Group 2";
        await typeInitiative(gm, rowOf(await gmOrder(gm), label), 40);
        await eventually(() => gmOrder(gm), rows => expect(rows[0]).toEqual([label, "40"]));
        await eventually(() => initiativeWindow(player), w => expect(w.rows[0]).toEqual([label, "40"]));
    });

    it("takes the order from the players while the gamemaster has another encounter open", async () => {
        const before = await initiativeWindow(player);
        encounters.push(await newEncounter(gm));
        await eventually(() => initiativeWindow(player), w => expect(w.rows).toEqual([]));
        await pickEncounter(gm, encounters[0]);
        await eventually(() => gmOrder(gm), rows => expect(rows).toHaveLength(4));
        await eventually(() => initiativeWindow(player), w => expect(w).toEqual(before));
    });

    it("goes round the groups with Next, into the next round, without a word in the chat", async () => {
        await player.clearRecords({ settle: false });
        const order = (await gmOrder(gm)).map(r => r[0]);
        for (let i = 0; i < order.length; i++) {
            await gm.page.locator(".encounter-next").click();
            await eventually(() => gmOrder(gm), rows => expect(rows[i][0]).toBe(`*${order[i]}`));
            await eventually(() => initiativeWindow(player), w => expect(w.rows[i][0]).toBe(`*${w.rows[i][0].replace(/^\*/, "")}`));
        }
        await gm.page.locator(".encounter-next").click();
        await eventually(() => gmRound(gm), round => expect(round).toBe(2));
        await eventually(() => gmOrder(gm), rows => expect(rows[0][0]).toBe(`*${order[0]}`));
        await eventually(() => initiativeWindow(player), w => expect(w.title).toBe("Initiative · round 2"));
        expect(await player.received("chatMessage")).toEqual([]);
    });

    it("resets the initiative of everyone, the open sheet of a player too, and starts round 1", async () => {
        await resetInitiative(gm);
        await eventually(() => gmRound(gm), round => expect(round).toBe(1));
        await eventually(() => gmOrder(gm), rows => {
            expect(rows.map(r => r[1])).toEqual(["—", "—", "—", "—"]);
            expect(rows.some(r => r[0].startsWith("*"))).toBe(false);
        });
        await eventually(() => initiativeWindow(player), w => {
            expect(w.title).toBe("Initiative · round 1");
            expect(w.rows.map(r => r[1])).toEqual(["—", "—", "—", "—"]);
        });
        // The player's sheet is open in their room: it shows no initiative without a reload.
        await eventually(() => player.el({ sel: "#lastInitiativeDisplay" }).then(el => el.textContent()), text => expect(text).toBe(""));
    });
});
