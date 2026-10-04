import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { SheetPayload } from "../../sheet/payload";
import type { RoomPayload } from "../payload.gen";
import type { EncounterParticipant, EncounterState } from "./types.gen";
import type { EncounterPayload } from "./messages";
import { encounter, sheetOf } from "./state";
import { initEncounter } from "./actions";
import { listenEncounter } from "./remote";
import { EncounterWindow } from "./components/EncounterWindow";
import { Toasts } from "../components/Toasts";
import { initRoomState, toasts } from "../state";

const sheet = (sheetId: string, name: string): SheetPayload => ({
    sheetId,
    kind: "black_crusade",
    canEdit: true,
    content: { characterInfo: { characterName: name }, initiative: { lastInitiative: 14 } } as unknown as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
});

const participant = (id: number, groupId: number, sheetId: number, npc: boolean, side: EncounterParticipant["side"]): EncounterParticipant =>
    ({ id, groupId, sheetId, npc, side, displayName: null, name: "", sourceCreatureId: null, sourceCreatureName: null, sourceLabel: null });

// Ulrich in the party, two orcs in a group and a servitor among the enemies.
const state = (changes: Partial<EncounterState> = {}): EncounterState => ({
    id: 1, roomId: 5, name: "Ambush", round: 3, currentGroupId: null, shown: false, initiativeView: null,
    version: 1, updatedAt: "",
    groups: [
        { id: 10, position: 0, name: null, room: true },
        { id: 12, position: 1, name: "Orcs", room: false },
        { id: 13, position: 2, name: null, room: false },
    ],
    participants: [
        participant(1, 10, 100, false, "party"),
        participant(3, 12, 200, true, "enemies"),
        participant(4, 12, 201, true, "enemies"),
        participant(5, 13, 202, true, "enemies"),
    ],
    ...changes,
});

const opened: EncounterPayload = {
    notes: "Mind the bridge",
    encounter: state(),
    sheets: [sheet("100", "Ulrich"), sheet("200", "Orc 1"), sheet("201", "Orc 2"), sheet("202", "Servitor")],
};

let sent: { type: string; [key: string]: unknown }[] = [];
const onSend = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));
const requests = (type: string) => sent.filter(m => m.type === type);

const box = document.createElement("div");
const toastBox = document.createElement("div");
const $ = (selector: string) => box.querySelector<HTMLElement>(selector);
const card = (id: number) => $(`.encounter-card[data-participant-id="${id}"]`);
const deleted = (id: number) => $(`.encounter-card-deleted[data-participant-id="${id}"]`);
const notes = () => $(".encounter-notes") as HTMLTextAreaElement;

function click(el: HTMLElement | null | undefined): void {
    if (!el) throw new Error("Nothing to click");
    act(() => el.click());
}

function receive(msg: { type: string; [key: string]: unknown }): void {
    act(() => {
        document.dispatchEvent(new CustomEvent(`ws:${msg.type}`, { detail: msg }));
    });
}

function type(text: string): void {
    act(() => {
        notes().value = text;
        notes().dispatchEvent(new Event("input", { bubbles: true }));
    });
}

beforeAll(async () => {
    document.body.append(box, toastBox);
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
    await vi.waitFor(() => expect(sheetOf(202)).not.toBeNull());
    act(() => {
        render(<EncounterWindow />, box);
        render(<Toasts />, toastBox);
    });
});

afterAll(() => {
    render(null, box);
    render(null, toastBox);
    document.removeEventListener("room:sendMessage", onSend);
    vi.unstubAllGlobals();
});

beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    toasts.value = [];
    receive({ type: "encounterState", eventID: "", encounter: state() });
});

afterEach(() => {
    // What a test left on its way, a removal or the notes, goes nowhere.
    if (document.activeElement instanceof HTMLElement) act(() => (document.activeElement as HTMLElement).blur());
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe("Add sheets", () => {
    it("opens a popup at its button, which a click outside closes", () => {
        click($(".encounter-add-sheets"));
        expect($(".encounter-add-sheets-box .encounter-add-sheets-popup")).not.toBeNull();
        expect($(".overlay")).toBeNull();

        click($(".encounter-column-title"));
        expect($(".encounter-add-sheets-popup")).toBeNull();
    });

    it("closes on Esc and on its button again", () => {
        click($(".encounter-add-sheets"));
        act(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
        expect($(".encounter-add-sheets-popup")).toBeNull();

        click($(".encounter-add-sheets"));
        click($(".encounter-add-sheets"));
        expect($(".encounter-add-sheets-popup")).toBeNull();
    });
});

describe("removing", () => {
    it("an NPC turns into a Deleted card at once, which goes with the removal five seconds later", () => {
        click(card(5)!.querySelector<HTMLElement>(".encounter-remove"));

        expect(card(5)).toBeNull();
        expect(deleted(5)!.textContent).toBe("Deleted ServitorUndo");
        expect($('.encounter-order-row[data-group-id="13"]')).toBeNull();
        expect(toastBox.querySelector(".toast")).toBeNull();
        act(() => void vi.advanceTimersByTime(4900));
        expect(requests("encounterRemove")).toEqual([]);

        act(() => void vi.advanceTimersByTime(100));
        const [removal] = requests("encounterRemove");
        expect(removal).toEqual({ type: "encounterRemove", encounterId: 1, participantIds: [5], eventID: expect.any(String) });
        // Gone until the server answers; refused, it is back.
        expect(deleted(5)).toBeNull();
        expect(card(5)).toBeNull();
        receive({ type: "response", eventID: removal.eventID, OK: false });
        expect(card(5)).not.toBeNull();
    });

    it("an NPC is back with Undo, and nothing goes", () => {
        click(card(3)!.querySelector<HTMLElement>(".encounter-remove"));
        click(card(5)!.querySelector<HTMLElement>(".encounter-remove"));
        // The orc keeps its place in the frame of its group.
        expect(deleted(3)!.closest(".encounter-group-frame")).not.toBeNull();
        // One orc of the two is left: the group is still in the order.
        expect($('.encounter-order-row[data-group-id="12"]')).not.toBeNull();

        click(deleted(3)!.querySelector<HTMLElement>(".encounter-undo"));
        expect(card(3)).not.toBeNull();
        expect(deleted(3)).toBeNull();
        expect(deleted(5)).not.toBeNull();
        act(() => void vi.advanceTimersByTime(5000));

        const [removal] = requests("encounterRemove");
        expect(removal).toEqual(expect.objectContaining({ participantIds: [5] }));
        receive({ type: "response", eventID: removal.eventID, OK: true });
        expect(card(5)).not.toBeNull();
    });

    it("an NPC waiting for Undo is not rolled for", () => {
        const initiative = sheetOf(202)!.state.initiative.lastInitiative;
        const before = initiative.peek();
        initiative.value = "0";
        click(card(5)!.querySelector<HTMLElement>(".encounter-remove"));
        click($(".encounter-roll-npcs"));
        expect(requests("encounterRollInitiative")).toEqual([]);
        click(deleted(5)!.querySelector<HTMLElement>(".encounter-undo"));
        initiative.value = before;
    });

    it("an NPC waiting for Undo goes before Next, which then passes the turn", () => {
        click(card(5)!.querySelector<HTMLElement>(".encounter-remove"));
        click($(".encounter-next"));

        expect(sent.map(m => m.type)).toEqual(["encounterRemove", "encounterNext"]);
        expect(requests("encounterRemove")[0]).toEqual(expect.objectContaining({ participantIds: [5] }));
        expect(deleted(5)).toBeNull();
        act(() => void vi.advanceTimersByTime(5000));
        expect(requests("encounterRemove")).toHaveLength(1);
        receive({ type: "response", eventID: requests("encounterRemove")[0].eventID, OK: false });
    });

    it("an NPC waiting for Undo goes before Prev too", () => {
        receive({ type: "encounterState", eventID: "", encounter: state({ currentGroupId: 13 }) });
        click(card(5)!.querySelector<HTMLElement>(".encounter-remove"));
        click($(".encounter-prev"));

        expect(sent.map(m => m.type)).toEqual(["encounterRemove", "encounterPrev"]);
        receive({ type: "response", eventID: requests("encounterRemove")[0].eventID, OK: false });
    });

    it("the removal of the group whose turn it is passes the turn instead of Next", () => {
        receive({ type: "encounterState", eventID: "", encounter: state({ currentGroupId: 13 }) });
        click(card(5)!.querySelector<HTMLElement>(".encounter-remove"));
        click($(".encounter-next"));

        expect(sent.map(m => m.type)).toEqual(["encounterRemove"]);
        receive({ type: "response", eventID: requests("encounterRemove")[0].eventID, OK: false });
    });

    it("a character sends the removal at once", () => {
        click(card(1)!.querySelector<HTMLElement>(".encounter-remove"));

        expect(requests("encounterRemove")).toEqual([expect.objectContaining({ encounterId: 1, participantIds: [1] })]);
        expect(deleted(1)).toBeNull();
    });
});

describe("the initiative buttons", () => {
    it("are over the order, with the round", () => {
        const section = $(".encounter-initiative")!;
        expect(section.compareDocumentPosition($(".encounter-order")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect($(".encounter-round")!.textContent).toBe("InitiativeRound 3");
        expect([...section.querySelectorAll("button")].map(b => b.textContent)).toEqual(["Reset", "Roll for NPCs", "Show to players", "⏮ Prev", "Next ⏭"]);
    });

    it("resets at once: the sheets lose their initiative and the server is told", () => {
        click($(".encounter-reset"));

        expect(Number(sheetOf(100)!.state.initiative!.lastInitiative!.peek())).toBe(0);
        expect(Number(sheetOf(202)!.state.initiative!.lastInitiative!.peek())).toBe(0);
        expect(requests("encounterResetInitiative")).toEqual([expect.objectContaining({ encounterId: 1 })]);
    });

    it("shows the encounter to the players, and hides it when pressed", () => {
        const show = () => $(".encounter-show")!;
        const list = (shownEncounterId: number | null) =>
            receive({ type: "encounterList", eventID: "", encounters: [{ id: 1, name: "Ambush", updatedAt: "" }], shownEncounterId });
        expect(show().getAttribute("aria-pressed")).toBe("false");
        click(show());
        expect(requests("encounterShow")).toEqual([expect.objectContaining({ encounterId: 1 })]);

        list(1);
        expect(show().getAttribute("aria-pressed")).toBe("true");
        click(show());
        expect(requests("encounterShow")[1]).toEqual(expect.objectContaining({ encounterId: null }));
        list(null);
    });

    it("is out of the encounter menu", () => {
        click($(".encounter-menu-btn"));
        const items = [...box.querySelectorAll(".encounter-menu button")].map(b => b.textContent ?? "");
        click($(".encounter-menu-btn"));

        expect(items).toContain("Rename");
        expect(items.filter(i => /initiative|players/.test(i))).toEqual([]);
    });
});

describe("the turn in the columns", () => {
    it("marks the cards of the group whose turn it is, and its frame", () => {
        const current = () => [...box.querySelectorAll(".encounter-card.current")].map(c => (c as HTMLElement).dataset.participantId);
        expect(current()).toEqual([]);

        receive({ type: "encounterState", eventID: "", encounter: state({ currentGroupId: 12 }) });
        expect(current()).toEqual(["3", "4"]);
        expect($('.encounter-group-frame[data-group-id="12"]')!.classList.contains("current")).toBe(true);

        receive({ type: "encounterState", eventID: "", encounter: state({ currentGroupId: 10 }) });
        expect(current()).toEqual(["1"]);
        expect($('.encounter-group-frame[data-group-id="12"]')!.classList.contains("current")).toBe(false);
    });

    it("takes the turn back with Prev", () => {
        click($(".encounter-prev"));
        expect(requests("encounterPrev")).toEqual([expect.objectContaining({ encounterId: 1 })]);
    });
});

describe("the notes", () => {
    it("go once the typing pauses, and not again on blur", () => {
        expect(notes().value).toBe("Mind the bridge");
        act(() => notes().focus());
        type("Mind the");
        act(() => void vi.advanceTimersByTime(500));
        type("Mind the troll");
        act(() => void vi.advanceTimersByTime(800));
        act(() => notes().blur());

        expect(requests("encounterDescribe")).toEqual([
            { type: "encounterDescribe", encounterId: 1, description: "Mind the troll", eventID: expect.any(String) },
        ]);
    });

    it("go at once on blur", () => {
        act(() => notes().focus());
        type("Ambush at dusk");
        act(() => notes().blur());
        act(() => void vi.advanceTimersByTime(800));

        expect(requests("encounterDescribe")).toEqual([expect.objectContaining({ description: "Ambush at dusk" })]);
    });

    it("keep what is typed while focused, and take those of another tab otherwise", () => {
        act(() => notes().focus());
        type("Mine");
        receive({ type: "encounterNotes", encounterId: 1, notes: "Theirs" });
        expect(notes().value).toBe("Mine");
        act(() => notes().blur());

        receive({ type: "encounterNotes", encounterId: 1, notes: "Theirs again" });
        expect(notes().value).toBe("Theirs again");
        // Of an encounter not open here.
        receive({ type: "encounterNotes", encounterId: 2, notes: "Elsewhere" });
        expect(notes().value).toBe("Theirs again");
    });

    it("stay as typed when the state comes back without them", () => {
        act(() => notes().focus());
        type("Bridge holds");
        act(() => notes().blur());
        receive({ type: "encounterState", eventID: "", encounter: state() });
        expect(notes().value).toBe("Bridge holds");
    });
});
