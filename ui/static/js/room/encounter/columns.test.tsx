import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import Sortable from "sortablejs";
import type { SheetPayload } from "../../sheet/payload";
import type { RoomPayload } from "../payload.gen";
import type { EncounterParticipant, EncounterState } from "./types.gen";
import type { EncounterPayload } from "./messages";
import { encounter } from "./state";
import { initEncounter } from "./actions";
import { listenEncounter } from "./remote";
import { EncounterWindow } from "./components/EncounterWindow";
import { initRoomState } from "../state";
import { sheets } from "../../sheet/instance";
import { updateSignalAtPath } from "../../sheet/state/sync";

const sheet = (sheetId: string, name: string, more: object = {}): SheetPayload => ({
    sheetId,
    kind: "black_crusade",
    canEdit: true,
    content: { characterInfo: { characterName: name }, armour: { woundsMax: 12, woundsCur: 0 }, ...more } as unknown as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
});

// The servitor's plating: 4 ablative wounds.
const plating = {
    conditions: {
        list: {
            items: {
                c1: {
                    name: "Plating", enabled: true, stacks: 1,
                    entries: { items: { e1: { type: "ablative_wounds", ablativeWounds: "4" } }, layouts: { e1: { colIndex: 0, rowIndex: 0 } } },
                },
            },
            layouts: { c1: { colIndex: 0, rowIndex: 0 } },
        },
    },
};

const participant = (id: number, groupId: number, sheetId: number, npc: boolean, side: EncounterParticipant["side"]): EncounterParticipant =>
    ({ id, groupId, sheetId, npc, side, displayName: null, name: "", sourceCreatureId: null, sourceCreatureName: null, sourceLabel: null });

// Ulrich in the party, Kayvaan, a character, among the enemies, two orcs in a
// group of NPCs, and a servitor, an NPC, in the party.
const state = (changes: Partial<EncounterState> = {}): EncounterState => ({
    id: 1, roomId: 5, name: "Ambush", round: 1, currentGroupId: null, shown: false, initiativeView: null, version: 1, updatedAt: "",
    groups: [
        { id: 10, position: 0, name: null, room: true },
        { id: 11, position: 1, name: null, room: true },
        { id: 12, position: 2, name: "Orcs", room: false },
        { id: 13, position: 3, name: null, room: false },
    ],
    participants: [
        participant(1, 10, 100, false, "party"),
        participant(2, 11, 101, false, "enemies"),
        participant(3, 12, 200, true, "enemies"),
        participant(4, 12, 201, true, "enemies"),
        participant(5, 13, 202, true, "party"),
    ],
    ...changes,
});

const opened: EncounterPayload = {
    notes: "",
    encounter: state(),
    sheets: [sheet("100", "Ulrich"), sheet("101", "Kayvaan"), sheet("200", "Orc 1"), sheet("201", "Orc 2"), sheet("202", "Servitor", plating)],
};

let sent: { type: string; [key: string]: unknown }[] = [];
const onSend = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));
const requests = (type: string) => sent.filter(m => m.type === type);

const box = document.createElement("div");
const $ = (selector: string) => box.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...box.querySelectorAll<HTMLElement>(selector)];
const column = (side: string) => $(`.participant-column[data-column="${side}"]`)!;
const cardIds = (side: string) => [...column(side).querySelectorAll<HTMLElement>(".encounter-card")].map(c => Number(c.dataset.participantId)).sort();
const card = (id: number) => $(`.encounter-card[data-participant-id="${id}"]`)!;

function click(el: HTMLElement | null | undefined): void {
    if (!el) throw new Error("Nothing to click");
    act(() => el.click());
}

function receive(msg: { type: string; [key: string]: unknown }): void {
    act(() => {
        document.dispatchEvent(new CustomEvent(`ws:${msg.type}`, { detail: msg }));
    });
}

/**
 * Calls Sortable's handlers of `list` as a drag of `item` into `to` would.
 * `meanwhile` runs mid-drag; `rendered` sees what the window shows then.
 */
function drag(list: HTMLElement, item: HTMLElement, to: HTMLElement, meanwhile = () => {}, rendered = () => {}): void {
    const { options } = Sortable.get(list)!;
    act(() => {
        options.onStart!({ item } as Sortable.SortableEvent);
        to.appendChild(item);
    });
    act(meanwhile);
    rendered();
    act(() => options.onEnd!({ item, from: list, to } as Sortable.SortableEvent));
}

beforeAll(async () => {
    document.body.appendChild(box);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const sheetId = url.match(/^\/sheet\/view\/(\d+)/)?.[1];
        return new Response(JSON.stringify(sheetId ? opened.sheets.find(s => s.sheetId === sheetId) : opened));
    }));
    document.addEventListener("room:sendMessage", onSend);
    initRoomState({
        roomId: 5, csrfToken: "token", inviteLink: "", chat: { messages: [], hasMore: false }, commands: [], dicePresets: [],
        sheetKinds: [{ kind: "black_crusade", label: "Black Crusade" }],
        players: [{
            id: 1, name: "gm", role: "gamemaster", joinedAt: "", folders: [],
            sheets: [{ id: 100, name: "Ulrich", kind: "black_crusade", visibility: "everyone_can_view", folderId: null, createdAt: "", updatedAt: "" },
                { id: 300, name: "Fresh", kind: "black_crusade", visibility: "everyone_can_view", folderId: null, createdAt: "", updatedAt: "" }],
        }],
    } as unknown as RoomPayload);
    listenEncounter();
    initEncounter({ encounters: { encounters: [{ id: 1, name: "Ambush", updatedAt: "" }], shownEncounterId: null }, initiativeView: null } as unknown as RoomPayload);
    await vi.waitFor(() => expect(encounter.value?.id).toBe(1));
    act(() => render(<EncounterWindow />, box));
});

afterAll(() => {
    render(null, box);
    document.removeEventListener("room:sendMessage", onSend);
    vi.unstubAllGlobals();
});

beforeEach(() => {
    sent = [];
    receive({ type: "encounterState", eventID: "", encounter: state() });
});

it("puts each participant into the column of its side, characters and NPCs alike", () => {
    expect(cardIds("party")).toEqual([1, 5]);
    expect(cardIds("enemies")).toEqual([2, 3, 4]);
    expect($$(".participant-column .encounter-column-title").map(t => t.textContent)).toEqual(["Party", "Enemies"]);
    expect([...column("party").querySelectorAll(".encounter-column-footer button")].map(b => b.textContent)).toEqual(["Add sheets", "Group"]);
    expect([...column("enemies").querySelectorAll(".encounter-column-footer button")].map(b => b.textContent))
        .toEqual(["Group"]);
});

describe("dragging a card", () => {
    it("into the other column moves it alone, out of its group", () => {
        const frame = $('.encounter-group-frame[data-group-id="12"]')!;

        drag(frame, card(3), column("party").querySelector(".encounter-column-body")!);

        expect(requests("encounterMove")).toEqual([{ type: "encounterMove", encounterId: 1, participantId: 3, side: "party", eventID: expect.any(String) }]);
        // Until the server answers, the card stays where it was.
        expect($$('[data-participant-id="3"]')).toHaveLength(1);
        expect(cardIds("enemies")).toEqual([2, 3, 4]);
        expect(frame.querySelectorAll(".encounter-card")).toHaveLength(2);
    });

    it("within its column changes nothing: the order there is the turn order", () => {
        const body = column("enemies").querySelector<HTMLElement>(".encounter-column-body")!;

        drag(body, card(2), $('.encounter-group-frame[data-group-id="12"]')!);

        expect(requests("encounterMove")).toEqual([]);
        expect($('.encounter-group-frame[data-group-id="12"] [data-participant-id="2"]')).toBeNull();
        expect(cardIds("enemies")).toEqual([2, 3, 4]);
    });

    it("holds the changes from the server until the drop", () => {
        const partyBody = column("party").querySelector<HTMLElement>(".encounter-column-body")!;
        let midDrag: number[] = [];

        drag(partyBody, card(1), column("enemies").querySelector(".encounter-column-body")!, () => {
            receive({ type: "encounterState", eventID: "", encounter: state({ participants: state().participants.filter(p => p.id !== 5) }) });
        }, () => {
            midDrag = $$(".encounter-card").map(c => Number(c.dataset.participantId)).sort();
        });

        expect(midDrag).toEqual([1, 2, 3, 4, 5]);
        expect(cardIds("party")).toEqual([1]);
        expect(requests("encounterMove")).toEqual([expect.objectContaining({ participantId: 1, side: "enemies" })]);
    });
});

describe("grouping", () => {
    const pick = (id: number) => card(id).querySelector<HTMLInputElement>(".encounter-pick");

    it("picks in its own column and never mixes characters with NPCs", () => {
        click(column("enemies").querySelector<HTMLElement>(".encounter-group"));
        expect(pick(1)).toBeNull();
        expect(pick(2)!.disabled).toBe(false);

        click(pick(3));
        expect(pick(2)!.disabled).toBe(true);
        click(card(2).querySelector<HTMLElement>(".encounter-card-title"));
        click(pick(4));
        click(column("enemies").querySelector<HTMLElement>(".encounter-group"));

        expect(requests("encounterGroup")).toEqual([expect.objectContaining({ participantIds: [3, 4] })]);
    });

    it("of characters leaves out the NPCs of the column", () => {
        click(column("party").querySelector<HTMLElement>(".encounter-group"));
        click(pick(1));

        expect(pick(5)!.disabled).toBe(true);
        click(column("party").querySelector<HTMLElement>(".encounter-group"));
    });
});

it("adds sheets to the party of the room, not to the encounter", () => {
    click($(".encounter-add-sheets"));
    expect(($('.encounter-add-sheets-popup input[data-sheet-id="100"]') as HTMLInputElement).disabled).toBe(true);
    click($('.encounter-add-sheets-popup input[data-sheet-id="300"]'));
    click($(".encounter-add-picked"));

    expect(requests("partyAdd")).toEqual([{ type: "partyAdd", encounterId: 1, sheetIds: [300], eventID: expect.any(String) }]);
    expect($(".encounter-add-sheets-popup")).toBeNull();
});

it("shows the wounds with the ablative ones on the right of the bar and the damage below zero on its left", async () => {
    const value = () => card(5).querySelector(".encounter-wounds-value")!.textContent;
    const filled = (part: string) => parseFloat(card(5).querySelector<HTMLElement>(`.encounter-wounds-${part} i`)!.style.width);
    const wound = (taken: number) => act(() => updateSignalAtPath(sheets.get("202")!.state, "armour.woundsCur", taken));
    await vi.waitFor(() => expect(value()).not.toBe("…"));

    expect(value()).toBe("12/12+4");
    expect([filled("critical"), filled("normal"), filled("ablative")]).toEqual([0, 100, 100]);
    // The ablative wounds go first.
    wound(6);
    expect(value()).toBe("10/12+0");
    expect([filled("critical"), filled("normal"), filled("ablative")]).toEqual([0, 10 / 12 * 100, 0]);
    expect(card(5).querySelector(".encounter-wounds-bar")!.classList.contains("below-zero")).toBe(false);
    wound(20);
    expect(value()).toBe("-4/12+0");
    expect([filled("critical"), filled("normal")]).toEqual([40, 0]);
    expect(card(5).querySelector(".encounter-wounds-bar")!.classList.contains("below-zero")).toBe(true);
    wound(0);
});
