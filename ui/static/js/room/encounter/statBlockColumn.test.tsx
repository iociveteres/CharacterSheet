import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { SheetPayload } from "../../sheet/payload";
import type { RoomPayload } from "../payload.gen";
import type { EncounterPayload } from "./messages";
import { encounter } from "./state";
import { initEncounter, selectParticipant } from "./actions";
import { StatBlockColumn } from "./components/StatBlockColumn";

const sheet = (sheetId: string, name: string, canEdit = true): SheetPayload => ({
    sheetId,
    kind: "black_crusade",
    canEdit,
    content: {
        characterInfo: { characterName: name },
        characteristics: { BS: { value: 40 } },
        armour: { woundsMax: 12, woundsCur: 2 },
    } as unknown as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
});

// Ulrich, a character, and a cultist the players know as "Figure in the shadows".
const opened: EncounterPayload = {
    encounter: {
        id: 1, roomId: 5, name: "Ambush", round: 1, currentGroupId: null, shown: false, initiativeView: null, version: 1, updatedAt: "",
        groups: [{ id: 10, position: 0, name: null }, { id: 11, position: 1, name: null }],
        participants: [
            { id: 1, groupId: 10, sheetId: 100, npc: false, displayName: null, name: "Ulrich" },
            { id: 2, groupId: 11, sheetId: 200, npc: true, displayName: "Figure in the shadows", name: "Cultist" },
        ],
    },
    sheets: [sheet("100", "Ulrich"), sheet("200", "Cultist")],
};

const box = document.createElement("div");
const $ = (selector: string) => box.querySelector<HTMLElement>(selector);
const block = () => $("#statblock-sheet")?.shadowRoot?.querySelector<HTMLElement>(".stat-block") ?? null;

beforeAll(async () => {
    // The sheet's styles come from the container's data-sheet-css (sheet/view.ts).
    document.body.innerHTML = `<div id="character-sheet-container" data-sheet-css="/sheet.css"></div>`;
    document.body.appendChild(box);
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
        new Response(url === "/sheet.css" ? ".stat-block {}" : JSON.stringify(opened))));
    // happy-dom's replace() resolves to undefined; browsers resolve to the sheet.
    vi.stubGlobal("CSSStyleSheet", class extends CSSStyleSheet {
        async replace(text: string): Promise<CSSStyleSheet> {
            await super.replace(text);
            return this;
        }
    });
    initEncounter({ encounters: { encounters: [{ id: 1, name: "Ambush", updatedAt: "" }], shownEncounterId: null }, initiativeView: null } as unknown as RoomPayload);
    await vi.waitFor(() => expect(encounter.value?.id).toBe(1));
    act(() => render(<StatBlockColumn />, box));
});

afterAll(() => {
    render(null, box);
    vi.unstubAllGlobals();
});

describe("the stat block column", () => {
    it("asks for a participant until one is picked", () => {
        expect(box.textContent).toContain("Pick a participant");
        expect(block()).toBeNull();
    });

    it("shows the NPC picked with its rolls", async () => {
        act(() => selectParticipant(2));
        expect($(".statblock-name")!.textContent).toBe("Cultist");
        expect($(".encounter-card-shown-as")!.textContent).toBe("for players: Figure in the shadows");
        expect($(".statblock-wounds")!.textContent).toBe("10/12");
        await vi.waitFor(() => expect(block()).not.toBeNull());
        expect(block()!.querySelector('[data-id="BS"] label.rollable')).not.toBeNull();
    });

    it("shows a character picked with its rolls, as the gamemaster may edit the sheet", async () => {
        act(() => selectParticipant(1));
        expect($(".statblock-name")!.textContent).toBe("Ulrich");
        expect($(".encounter-card-shown-as")).toBeNull();
        await vi.waitFor(() => expect($("#statblock-sheet")?.dataset.sheetId).toBe("100"));
        expect(block()!.querySelector('[data-id="BS"] label.rollable')).not.toBeNull();
    });
});
