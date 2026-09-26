import { afterEach, describe, expect, it, vi } from "vitest";
import { loadState } from "../sheet/components/testUtils";
import { teardownSheet } from "../sheet/lifecycle";
import { applyRemoteToState } from "../sheet/state/remote";
import { announceCharacterName } from "../sheet/characterName";
import { diceMixin } from "./dice.js";

afterEach(teardownSheet);

/** The character name a roll from the room and one from the sheet are sent with. */
function signatures() {
    const room = { $nextTick: fn => fn(), sendChatMessage: vi.fn() };
    diceMixin.handleRollVersus.call(room, { target: 40, bonusSuccesses: 0, label: "" });
    diceMixin.handleRollExact.call(room, { expression: "1d10", label: "" });
    return room.sendChatMessage.mock.calls.map(([name]) => name);
}

describe("roll signature", () => {
    it("is the name of the open character, as the sheet tells it", () => {
        expect(signatures()).toEqual([null, null]);

        loadState({ characterInfo: { characterName: "Kharn" } });
        announceCharacterName("7");
        expect(signatures()).toEqual(["Kharn", "Kharn"]);

        applyRemoteToState({ type: "change", path: "characterInfo.characterName", change: "  Lorgar " });
        expect(signatures()).toEqual(["Lorgar", "Lorgar"]);

        applyRemoteToState({ type: "change", path: "characterInfo.characterName", change: " " });
        expect(signatures()).toEqual([null, null]);

        applyRemoteToState({ type: "change", path: "characterInfo.characterName", change: "Abaddon" });
        teardownSheet();
        expect(signatures()).toEqual([null, null]);
    });
});
