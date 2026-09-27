import { beforeAll, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { mountIslands } from "./islands";
import { initRoomState } from "./state";
import type { RoomPayload } from "./payload.gen";

const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;

beforeAll(() => {
    // The mount points of view_room.html.
    document.body.innerHTML = `
        <div class="room" id="room">
            <div class="toasts" id="toasts"></div>
            <div id="character-sheet-container"></div>
            <div id="right-panel-wrapper">
                <div class="room-controls-container" id="room-controls"></div>
                <div id="right-panel">
                    <div id="chat"></div><div id="characters"></div><div id="players"></div>
                </div>
            </div>
            <div id="modals"></div>
        </div>`;
    localStorage.setItem("rightPanelVisible", "false");
    initRoomState({
        roomId: 5,
        csrfToken: "",
        inviteLink: "",
        players: [{ id: 1, name: "Me", role: "player", joinedAt: "", folders: [], sheets: [] }],
        chat: { messages: [], hasMore: false },
        commands: [],
        dicePresets: [],
        sheetKinds: [],
    } as unknown as RoomPayload);
    act(() => mountIslands());
});

describe("the right panel", () => {
    it("starts hidden when the player hid it", () => {
        expect($("#room").classList.contains("panel-hidden")).toBe(true);
        expect($("#right-panel").classList.contains("hidden-panel")).toBe(true);
        expect($(".toggle-panel-btn").title).toBe("Show sidebar");
        expect($(".toggle-panel-btn").textContent).toBe("←");
    });

    it("shows and hides from its button, and remembers it", () => {
        act(() => $(".toggle-panel-btn").click());

        expect($("#room").classList.contains("panel-hidden")).toBe(false);
        expect($("#right-panel").classList.contains("hidden-panel")).toBe(false);
        expect($(".toggle-panel-btn").title).toBe("Hide sidebar");
        expect($(".toggle-panel-btn").textContent).toBe("→");
        expect(localStorage.getItem("rightPanelVisible")).toBe("true");

        act(() => $(".toggle-panel-btn").click());

        expect($("#room").classList.contains("panel-hidden")).toBe(true);
        expect(localStorage.getItem("rightPanelVisible")).toBe("false");
    });

    it("keeps the dice roller next to its button", () => {
        expect($("#room-controls > #dice-roller.dice-roller-wrapper > .dice-roller-btn")).not.toBeNull();
        expect($("#room-controls > #dice-roller + .toggle-panel-btn")).not.toBeNull();
    });
});
