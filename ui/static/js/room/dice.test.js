import { afterEach, describe, expect, it, vi } from "vitest";
import { loadState } from "../sheet/components/testUtils";
import { teardownSheet } from "../sheet/lifecycle";
import { applyRemoteToState } from "../sheet/state/remote";
import { announceCharacterName } from "../sheet/characterName";
import { diceMixin } from "./dice.js";
import { chatMixin } from "./chat.js";

afterEach(teardownSheet);

/** The character name a roll from the room and one from the sheet are sent with. */
function signatures() {
    const room = { $nextTick: fn => fn(), sendChat: vi.fn() };
    diceMixin.handleRollVersus.call(room, { target: 40, bonusSuccesses: 0, label: "" });
    diceMixin.handleRollExact.call(room, { expression: "1d10", label: "" });
    return room.sendChat.mock.calls.map(([, name]) => name);
}

/** The chat messages the room sends while `act` runs. */
function sentWhile(act) {
    const sent = [];
    const listener = e => sent.push(JSON.parse(e.detail));
    document.addEventListener("room:sendMessage", listener);
    try {
        act();
    } finally {
        document.removeEventListener("room:sendMessage", listener);
    }
    return sent.map(({ messageBody, characterName }) => ({ messageBody, characterName }));
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

describe("a roll", () => {
    it("goes to the chat without touching the draft in the input", () => {
        const room = {
            ...chatMixin,
            ...diceMixin,
            customDice: ["2d10+5", "", "", "", ""],
            $nextTick: fn => fn(),
            $refs: {},
            $store: { room: { roomId: 5 } },
            chatInput: "half a sentence",
        };

        const sent = sentWhile(() => {
            room.rollStandardDice(10);
            room.rollCustomDice(0);
            room.handleRollVersus({ target: 40, bonusSuccesses: 1, label: "Awareness" });
            room.handleRollExact({ expression: "2d10", label: "" });
        });

        expect(sent.map(m => m.messageBody)).toEqual([
            "/r 1d10",
            "/r 2d10+5",
            "/r d100 vs 40 [+1]\n>> Awareness",
            "/r 2d10",
        ]);
        expect(room.chatInput).toBe("half a sentence");
    });
});

describe("the Send button", () => {
    it("sends the input without a character, whatever Alpine passes it", () => {
        const room = { ...chatMixin, $store: { room: { roomId: 5 } }, chatInput: "hello" };

        const sent = sentWhile(() => room.sendChatMessage(new MouseEvent("click")));

        expect(sent).toEqual([{ messageBody: "hello", characterName: undefined }]);
        expect(room.chatInput).toBe("");
    });
});

describe("Enter in the chat input", () => {
    const keydown = shiftKey => new KeyboardEvent("keydown", { key: "Enter", shiftKey, cancelable: true });

    it("sends the message", () => {
        const room = { ...chatMixin, $store: { room: { roomId: 5 } }, chatInput: "hello" };
        const e = keydown(false);

        const sent = sentWhile(() => room.handleChatKeydown(e));

        expect(sent).toEqual([{ messageBody: "hello", characterName: undefined }]);
        expect(e.defaultPrevented).toBe(true);
    });

    it("with Shift leaves the new line to the browser", () => {
        const room = { ...chatMixin, $store: { room: { roomId: 5 } }, chatInput: "hello" };
        const e = keydown(true);

        const sent = sentWhile(() => room.handleChatKeydown(e));

        expect(sent).toEqual([]);
        expect(e.defaultPrevented).toBe(false);
        expect(room.chatInput).toBe("hello");
    });
});
