import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetPayload } from "../../sheet/payload";
import { holdSheet, releaseSheet, sheets } from "../../sheet/instance";
import "../../sheet/network";
import type { RoomPayload } from "../payload.gen";
import type { EncounterState } from "./types.gen";
import type { EncounterPayload } from "./messages";
import { encounter, groups, notes } from "./state";
import { changeWounds, initEncounter, pickEncounter, rollForNpcs, setInitiative } from "./actions";
import { listenEncounter } from "./remote";

const sheet = (sheetId: string, name: string, agility: number, extra: object = {}): SheetPayload => ({
    sheetId,
    kind: "black_crusade",
    canEdit: true,
    content: {
        characterInfo: { characterName: name },
        characteristics: { A: { value: agility } },
        initiative: { dice: "1d10", aBonus: true, lastInitiative: 0 },
        armour: { woundsMax: 12, woundsCur: 2 },
        ...extra,
    } as unknown as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
});

const participant = (id: number, groupId: number, sheetId: number, npc: boolean, displayName: string | null = null) =>
    ({ id, groupId, sheetId, npc, side: npc ? "enemies" as const : "party" as const, displayName, name: "", sourceCreatureId: null, sourceCreatureName: null, sourceLabel: null });

// Ulrich (a character, rolled 9), and two orcs in a group of NPCs, and a
// cultist the players know as "Figure in the shadows".
const state = (changes: Partial<EncounterState> = {}): EncounterState => ({
    id: 1, roomId: 5, name: "Ambush", round: 1, currentGroupId: null, shown: true, initiativeView: null, version: 1, updatedAt: "",
    groups: [{ id: 10, position: 0, name: null, room: false }, { id: 11, position: 1, name: "Orcs", room: false }, { id: 12, position: 2, name: null, room: false }],
    participants: [
        participant(1, 10, 100, false),
        participant(2, 11, 200, true),
        participant(3, 11, 201, true),
        participant(4, 12, 202, true, "Figure in the shadows"),
    ],
    ...changes,
});

const opened: EncounterPayload = {
    notes: "",
    encounter: state(),
    sheets: [
        sheet("100", "Ulrich", 42, { initiative: { dice: "1d10", aBonus: true, lastInitiative: 9 } }),
        sheet("200", "Orc 1", 30),
        sheet("201", "Orc 2", 45),
        sheet("202", "Cultist", 20),
    ],
};

let sent: { type: string; [key: string]: unknown }[] = [];
const onSend = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));
const receive = (msg: { type: string; [key: string]: unknown }) =>
    document.dispatchEvent(new CustomEvent(`ws:${msg.type}`, { detail: msg }));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
// The view the gamemaster's client published first.
let publishedView: EncounterState["initiativeView"] = null;

beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(opened))));
    document.addEventListener("room:sendMessage", onSend);
    listenEncounter();
    initEncounter({
        encounters: { encounters: [{ id: 1, name: "Ambush", updatedAt: "" }], shownEncounterId: 1 },
        initiativeView: null,
    } as unknown as RoomPayload);
    await vi.waitFor(() => expect(encounter.value?.id).toBe(1));
});

afterAll(() => {
    document.removeEventListener("room:sendMessage", onSend);
    vi.unstubAllGlobals();
});

beforeEach(() => {
    sent = [];
});

describe("an encounter opened", () => {
    it("holds the sheets of its participants", () => {
        expect([...sheets.keys()].sort()).toEqual(["100", "200", "201", "202"]);
    });

    it("sorts its groups and publishes the order with the names the players see", async () => {
        expect(groups.value.map(g => g.id)).toEqual([10, 11, 12]);
        // Ulrich rolled 9 with AgB 4; the orcs and the cultist have not rolled.
        expect(groups.value.map(g => g.value)).toEqual([13, null, null]);
        await vi.waitFor(() => expect(sent.some(m => m.type === "encounterOrder")).toBe(true));
        const order = sent.find(m => m.type === "encounterOrder")!;
        expect(order.view).toEqual({
            round: 1,
            current: null,
            rows: [{ name: "Ulrich", value: 13 }, { name: "Orcs", value: null }, { name: "Figure in the shadows", value: null }],
        });
        publishedView = order.view as EncounterState["initiativeView"];
    });

    it("does not publish an order the server has already", async () => {
        receive({ type: "encounterState", eventID: "", encounter: state({ initiativeView: publishedView }) });
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(sent.filter(m => m.type === "encounterOrder")).toEqual([]);
    });

    it("publishes the same order again once the server has dropped it", async () => {
        // Replacing the NPCs from a file clears the view, though the order may stay the same.
        receive({ type: "encounterState", eventID: "", encounter: state({ initiativeView: null }) });
        await vi.waitFor(() => expect(sent.find(m => m.type === "encounterOrder")?.view).toEqual(publishedView));
        receive({ type: "encounterState", eventID: "", encounter: state({ initiativeView: publishedView }) });
    });
});

describe("rolling for NPCs", () => {
    it("rolls once for a group, by its best AgB, and for each NPC, under the names the players see", () => {
        rollForNpcs();
        expect(sent).toEqual([expect.objectContaining({
            type: "encounterRollInitiative",
            encounterId: 1,
            rolls: [
                { sheetId: 201, name: "Orcs", expression: "1d10+4" },
                { sheetId: 202, name: "Figure in the shadows", expression: "1d10+2" },
            ],
        })]);
    });

    it("keeps the totals in the sheets, less their modifiers", async () => {
        rollForNpcs();
        const eventID = sent[0].eventID;
        receive({ type: "encounterRolled", eventID, totals: [{ sheetId: 201, total: 11 }, { sheetId: 202, total: 5 }] });

        expect(sheets.get("201")!.state.initiative.lastInitiative.value).toBe(7);
        expect(sheets.get("202")!.state.initiative.lastInitiative.value).toBe(3);
        expect(groups.value.map(g => [g.id, g.value])).toEqual([[10, 13], [11, 11], [12, 5]]);
    });

    it("leaves out those who have rolled", async () => {
        sent = [];
        rollForNpcs();
        expect(sent.filter(m => m.type === "encounterRollInitiative")).toEqual([]);
    });
});

describe("the gamemaster", () => {
    it("types an initiative into the sheet whose value the group takes", () => {
        setInitiative(11, 20);
        // Orc 2 has the group's value, with AgB 4.
        expect(sheets.get("201")!.state.initiative.lastInitiative.value).toBe(16);
        expect(groups.value[0].id).toBe(11);
        setInitiative(11, null);
        expect(sheets.get("201")!.state.initiative.lastInitiative.value).toBe(0);
    });

    it("heals and wounds with an edit of the sheet's damage", () => {
        changeWounds(1, -1);
        expect(sheets.get("100")!.state.armour.woundsCur.value).toBe(3);
        changeWounds(1, 1);
        changeWounds(1, 1);
        changeWounds(1, 1);
        changeWounds(1, 1);
        expect(sheets.get("100")!.state.armour.woundsCur.value).toBe(0);
    });
});

describe("a participant gone", () => {
    it("lets go of its sheet", async () => {
        receive({
            type: "encounterState", eventID: "",
            encounter: state({ groups: state().groups.slice(0, 2), participants: state().participants.slice(0, 3) }),
        });
        await flush();
        expect(sheets.has("202")).toBe(false);
        expect(sheets.has("201")).toBe(true);
    });
});

describe("sheets on the page", () => {
    it("are held as they are, not read again, for a new participant", async () => {
        holdSheet(sheet("300", "Gerta", 35));
        vi.mocked(fetch).mockClear();
        const groups = [...state().groups.slice(0, 2), { id: 13, position: 2, name: null, room: true }];
        const participants = [...state().participants.slice(0, 3), participant(5, 13, 300, false)];
        receive({ type: "encounterState", eventID: "", encounter: state({ groups, participants }) });
        await flush();
        expect(fetch).not.toHaveBeenCalled();
        // The encounter lets go of it, and the one who held it first keeps it.
        receive({ type: "encounterState", eventID: "", encounter: state({ groups: groups.slice(0, 2), participants: participants.slice(0, 3) }) });
        expect(sheets.has("300")).toBe(true);
        releaseSheet("300");
        expect(sheets.has("300")).toBe(false);
    });

    it("are left out when the encounter is read again after a reconnect", async () => {
        vi.mocked(fetch).mockClear();
        const read = () => vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url), "http://localhost"))
            .find(url => url.pathname === "/encounter/1");
        // sheet/reload.ts reads each sheet on the page again by itself.
        document.dispatchEvent(new CustomEvent("ws:reconnected"));
        await vi.waitFor(() => expect(read()).toBeDefined());
        const url = read()!;
        expect(url.searchParams.get("have")?.split(",").sort()).toEqual(["100", "200", "201"]);
    });
});

describe("a change of the party made in another tab", () => {
    const reads = () => vi.mocked(fetch).mock.calls.filter(([url]) => new URL(String(url), "http://localhost").pathname === "/encounter/1");

    it("reads the open encounter again when it is past the version here", async () => {
        vi.mocked(fetch).mockClear();
        const version = encounter.value!.version;
        receive({ type: "encountersChanged", encounters: [{ id: 2, version: 9 }, { id: 1, version }] });
        await flush();
        expect(reads()).toEqual([]);

        const renamed = { ...opened, encounter: { ...opened.encounter, name: "Ambush at dusk", version: version + 1 }, notes: "Read again" };
        vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify(renamed)));
        receive({ type: "encountersChanged", encounters: [{ id: 1, version: version + 1 }] });
        await vi.waitFor(() => expect(encounter.value?.name).toBe("Ambush at dusk"));
        expect(reads()).toHaveLength(1);
        expect(notes.value).toBe("Read again");
    });

    it("keeps a newer state that came meanwhile", async () => {
        const version = encounter.value!.version;
        const older = { ...opened, encounter: { ...opened.encounter, name: "Older", version: version + 1 } };
        let answer!: (r: Response) => void;
        vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { answer = resolve; }));
        receive({ type: "encountersChanged", encounters: [{ id: 1, version: version + 1 }] });
        receive({ type: "encounterState", eventID: "", encounter: { ...encounter.value!, name: "Newer", version: version + 2 } });
        answer(new Response(JSON.stringify(older)));
        await flush();
        await flush();
        expect(encounter.value?.name).toBe("Newer");
    });
});

describe("another encounter opened", () => {
    it("takes the shown order from the players until the shown one is open again", async () => {
        receive({ type: "initiativeView", view: publishedView });
        const other: EncounterPayload = {
            encounter: state({ id: 2, name: "Ruins", shown: false, groups: [], participants: [] }),
            notes: "",
            sheets: [],
        };
        vi.mocked(fetch).mockImplementation(async url => new Response(JSON.stringify(new URL(String(url), "http://localhost").pathname === "/encounter/2" ? other : opened)));
        pickEncounter(2);
        expect(sent.filter(m => m.type === "encounterDropView")).toEqual([expect.objectContaining({ encounterId: 1 })]);
        await vi.waitFor(() => expect(encounter.value?.id).toBe(2));
        receive({ type: "initiativeView", view: null });

        sent = [];
        // The server has no view of it now: the order goes again, though unchanged.
        pickEncounter(1);
        await vi.waitFor(() => expect(sent.find(m => m.type === "encounterOrder" && m.encounterId === 1)?.view).toBeTruthy());
        expect(sent.filter(m => m.type === "encounterDropView")).toEqual([]);
    });
});
