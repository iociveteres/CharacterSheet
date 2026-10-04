// The file of an encounter: the gamemaster exports its NPCs, loads the file
// back as a new encounter next to a broken one, puts a file's NPCs in place of
// those of the encounter shown to the players, and adds a variant of an NPC
// to the bestiary. Runs on the seeded room: `npm run seed`. Acceptance
// checklist, item 20.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seed, seedUser } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import type { Msg } from "../../lib/probes";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";
import { bestiary, deleteCollections, expectToast, uploadCreature, type Creature } from "../../lib/bestiary";
import {
    addCreature, addSheets, BLANK_NPC, card, clearParty, column, columnSheets, deleteEncounter, editsStored, enterGmMode, gmOrder, gmRound, group, initiativeWindow, newEncounter, newNpc,
    openEncounterId, openInitiativeWindow, pickEncounter, setDisplayName, showToPlayers,
} from "../../lib/encounter";

const PREFIX = "e2e File";
const COLLECTION = `${PREFIX} Orks`;
const ORC = `${PREFIX} Orc`;
const SHOWN = `${PREFIX} Shadow`;
const LOADED = `${PREFIX} Loaded`;
const GROT = `${PREFIX} Grot`;
const NOB = `${PREFIX} Nob`;
const BOSS = `${PREFIX} Boss`;

interface EncounterFile {
    format: string;
    version: number;
    name: string;
    round: number;
    groups: { ref: string; name: string | null }[];
    npcs: { group: string; side: "party" | "enemies"; displayName: string | null; sheetKind: string; content: any; sourceLabel: string | null; sourceSheetId: number | null }[];
}

const json = (name: string, body: unknown) => ({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(body)) });

/** The encounters in the gamemaster's picker: id and name. */
async function picker(gm: Player): Promise<{ id: number; name: string }[]> {
    return gm.page.locator(".encounter-picker select option").evaluateAll(options => options
        .map(o => ({ id: Number((o as HTMLOptionElement).value), name: (o.textContent ?? "").replace(/^👁 /, "") }))
        .filter(o => o.id));
}

const npcTitles = (gm: Player) => column(gm, "enemies").locator(".encounter-card-title").allTextContents();

const npcSheets = (gm: Player) => columnSheets(gm, "enemies");

/** The menu of an NPC: the texts of its buttons; the menu is closed again. */
async function npcMenu(gm: Player, sheetId: number): Promise<string[]> {
    await card(gm, sheetId).locator(".encounter-npc-menu-btn").click();
    const items = await card(gm, sheetId).locator(".encounter-npc-menu button").allTextContents();
    await card(gm, sheetId).locator(".encounter-npc-menu-btn").click();
    return items;
}

describe("the file of an encounter", () => {
    let browser: Browser;
    let gm: Player;
    let player: Player;
    let encounter = 0;
    let collection = 0;
    let creature = 0;
    let file: EncounterFile;
    const playerSheet = () => seedUser("player").sheetId!;

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "gm", { role: "gm" });
        player = await Player.create(browser, "player", { role: "player" });
        await player.openRoom(seed().roomId);
        await gm.openRoom(seed().roomId);
        await deleteCollections(gm.page, PREFIX);
        await enterGmMode(gm);
        for (const e of await picker(gm)) if (e.name.startsWith(PREFIX)) await deleteEncounter(gm, e.id);
        // The order counts on the player's sheet as the only character.
        await clearParty(gm);

        // A creature of the gamemaster's: a copy of the player's sheet.
        collection = (await bestiary<{ id: number }>(gm.page, "POST", "/bestiary/collections", { name: COLLECTION })).id;
        creature = await uploadCreature(gm.page, collection, ORC, playerSheet());
    });

    afterEach(() => expectNoErrors([gm, player]));

    afterAll(async () => {
        try {
            if (gm) await clearParty(gm);
            if (encounter) await deleteEncounter(gm, encounter);
            for (const e of await picker(gm)) if (e.name.startsWith(PREFIX)) await deleteEncounter(gm, e.id);
            await deleteCollections(gm.page, PREFIX);
        } finally {
            await browser?.close();
        }
    });

    it("exports the NPCs of the encounter, their group and names, without the character and the initiative", async () => {
        encounter = await newEncounter(gm);
        await addSheets(gm, [playerSheet()]);
        await addCreature(gm, collection, creature, 2);
        await eventually(() => npcTitles(gm), names => expect(names.sort()).toEqual([`${ORC} 1`, `${ORC} 2`]));
        const orcs = await npcSheets(gm);
        await group(gm, "enemies", orcs);
        await setDisplayName(gm, orcs[0], SHOWN);
        await newNpc(gm);
        // The NPCs roll: the file has none of it.
        await gm.page.locator(".encounter-roll-npcs").click();
        await gm.waitReceived(m => m.type === "encounterRolled", "the roll for the NPCs");
        for (let i = 0; i < 4; i++) await gm.page.locator(".encounter-next").click();
        await eventually(() => gmRound(gm), round => expect(round).toBe(2));

        file = await gm.page.evaluate(async id => (await fetch(`/encounter/${id}/export`)).json(), encounter) as EncounterFile;
        expect(file).toMatchObject({ format: "encounter", version: 2, round: 2 });
        expect(file.npcs.map(n => n.side)).toEqual(["enemies", "enemies", "enemies"]);
        expect(file.npcs).toHaveLength(3);
        const names = file.npcs.map(n => n.content.characterInfo.characterName);
        expect(names.sort()).toEqual([BLANK_NPC, `${ORC} 1`, `${ORC} 2`]);
        expect(file.npcs.every(n => Number(n.content.initiative?.lastInitiative ?? 0) === 0)).toBe(true);
        const orcsInFile = file.npcs.filter(n => n.sourceSheetId !== null);
        expect(orcsInFile.map(n => n.sourceSheetId)).toEqual([creature, creature]);
        expect(new Set(orcsInFile.map(n => n.group)).size).toBe(1);
        expect(file.groups.map(g => g.ref)).toContain(orcsInFile[0].group);
        expect(file.npcs.map(n => n.displayName)).toContain(SHOWN);
    });

    it("loads the file as a new encounter next to a broken one, the open one staying open", async () => {
        await gm.page.locator(".encounter-load-input").setInputFiles([
            json("ambush.json", { ...file, name: LOADED }),
            { name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{}") },
        ]);
        await expectToast(gm.page, `ambush.json: "${LOADED}", 3 NPCs\nbroken.json: not an encounter file`);
        expect(await openEncounterId(gm)).toBe(encounter);
        const loaded = await eventually(() => picker(gm), list => expect(list.map(e => e.name)).toContain(LOADED));

        await pickEncounter(gm, loaded.find(e => e.name === LOADED)!.id);
        await eventually(() => npcTitles(gm), names => expect(names.sort()).toEqual([BLANK_NPC, `${ORC} 1`, `${ORC} 2`]));
        expect(await gmRound(gm)).toBe(2);
        expect((await gmOrder(gm)).some(([name]) => name.startsWith("*"))).toBe(false);
        expect(await column(gm, "enemies").locator(".encounter-group-frame .encounter-card").count()).toBe(2);
        expect(await column(gm, "enemies").locator(".encounter-card-shown-as").allTextContents()).toEqual([SHOWN]);
        const sheets = await npcSheets(gm);
        const titles = await npcTitles(gm);
        for (const [i, sheet] of sheets.entries()) {
            const variant = (await npcMenu(gm, sheet)).includes("Add variant to bestiary…");
            expect(variant, titles[i]).toBe(titles[i] !== BLANK_NPC);
        }
    });

    it("replaces the NPCs of the shown encounter, keeping the player's sheet", async () => {
        await pickEncounter(gm, encounter);
        await showToPlayers(gm);
        await openInitiativeWindow(player);
        // The orcs are an unnamed group: the players see "Group 1".
        const before = await eventually(() => initiativeWindow(player), w => expect(w.rows.map(r => r[0])).toContain(BLANK_NPC));
        expect(before.rows).toHaveLength(3);
        const oldNpcs = await npcSheets(gm);
        await player.clearRecords({ settle: false });

        const grot = { ...file.npcs.find(n => n.sourceSheetId === null)!, group: "", displayName: null };
        grot.content = { ...grot.content, characterInfo: { ...grot.content.characterInfo, characterName: GROT } };
        await gm.page.locator(".encounter-replace-input").setInputFiles(json("grot.json", { ...file, groups: [], npcs: [grot] }));
        await gm.page.locator("#confirm-modal button", { hasText: "OK" }).click();

        await eventually(() => npcTitles(gm), names => expect(names).toEqual([GROT]));
        await card(gm, playerSheet()).waitFor();
        const after = await eventually(() => initiativeWindow(player), w => expect(w.rows.map(r => r[0])).toContain(GROT));
        // The file's round has no turn: no row is current.
        const character = before.rows.map(r => r[0].replace("*", "")).find(name => name !== BLANK_NPC && !name.startsWith("Group"));
        expect(after.rows.map(r => r[0]).sort()).toEqual([character, GROT].sort());

        const received = await player.received();
        const grotSheet = (await npcSheets(gm))[0];
        const ofNpc = (m: Msg) => [m.sheetID, m.sheetId].some(id => id !== undefined && [...oldNpcs, grotSheet].map(String).includes(String(id)));
        expect(received.filter(ofNpc)).toEqual([]);
        expect(received.filter(m => m.type === "encounterState" || m.type === "encounterList")).toEqual([]);
        expect(JSON.stringify(received)).not.toContain("woundsMax");
    });

    it("adds a variant of an NPC next to its creature, which stays as it was", async () => {
        const loaded = (await picker(gm)).find(e => e.name === LOADED)!.id;
        await pickEncounter(gm, loaded);
        await eventually(() => npcTitles(gm), names => expect(names.sort()).toEqual([BLANK_NPC, `${ORC} 1`, `${ORC} 2`]));
        const orc = (await npcSheets(gm))[(await npcTitles(gm)).indexOf(`${ORC} 1`)];
        await card(gm, orc).locator(".encounter-wounds-minus").click();
        await editsStored(gm, orc);

        const addVariant = async (name: string) => {
            await card(gm, orc).locator(".encounter-npc-menu-btn").click();
            await card(gm, orc).locator(".encounter-add-variant").click();
            await gm.page.locator(".add-variant-name").fill(name);
            await gm.page.locator(".add-variant-add").click();
            await expectToast(gm.page, `"${name}" added to ${COLLECTION}`);
        };
        await addVariant(NOB);
        const creatures = async () => bestiary<Creature[]>(gm.page, "GET", `/bestiary/creatures?collection=${collection}`);
        expect((await creatures()).map(c => c.name)).toEqual([NOB, ORC]);
        const source = await bestiary<{ content: any }>(gm.page, "GET", `/sheet/view/${creature}`);
        expect(source.content.characterInfo.characterName).toBe(ORC);
        expect(Number(source.content.armour?.woundsCur ?? 0)).toBe(0);
        const nob = (await creatures()).find(c => c.name === NOB)!.id;
        expect(Number((await bestiary<{ content: any }>(gm.page, "GET", `/sheet/view/${nob}`)).content.armour.woundsCur)).toBe(1);

        // The next variant goes on from the first one.
        await eventually(async () => {
            await card(gm, orc).locator(".encounter-npc-menu-btn").click();
            const title = await card(gm, orc).locator(".encounter-add-variant").getAttribute("title");
            await card(gm, orc).locator(".encounter-npc-menu-btn").click();
            return title;
        }, title => expect(title).toBe(`A new creature next to "${NOB}"`));
        await addVariant(BOSS);
        expect((await creatures()).map(c => c.name)).toEqual([BOSS, NOB, ORC]);
    });
});
