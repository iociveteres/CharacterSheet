import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupChat, readInputHistory, rememberInput } from "./chat";
import type { ChatMessage } from "./payload.gen";

let lastId = 0;
function msg(userId: number, characterName: string | null, createdAt = new Date(2026, 8, 27, 10).toISOString()): ChatMessage {
    const id = ++lastId;
    return { id, userId, userName: `user${userId}`, messageBody: `m${id}`, commandResult: null, characterName, createdAt };
}

/** The groups as [day, [author, [character, message ids]]]. */
const shape = (messages: ChatMessage[]) => groupChat(messages).map(day => [
    day.key,
    day.authors.map(a => [a.userName, a.characters.map(c => [c.characterName, c.messages.map(m => m.id)])]),
]);

describe("grouping the chat", () => {
    beforeEach(() => {
        lastId = 0;
    });

    it("goes by local day, then by player in a row, then by character", () => {
        const today = new Date(2026, 8, 27, 10).toISOString();
        const tomorrow = new Date(2026, 8, 28, 0, 1).toISOString();
        const messages = [msg(1, null, today), msg(1, "Kharn", today), msg(2, null, today), msg(2, null, tomorrow)];

        expect(shape(messages)).toEqual([
            [new Date(today).toDateString(), [
                ["user1", [[null, [1]], ["Kharn", [2]]]],
                ["user2", [[null, [3]]]],
            ]],
            [new Date(tomorrow).toDateString(), [["user2", [[null, [4]]]]]],
        ]);
    });

    it("keeps a message without a character in the character group before it", () => {
        const messages = [msg(1, "Kharn"), msg(1, null), msg(1, "Kharn"), msg(1, "Lorgar"), msg(1, null)];

        expect(shape(messages)).toEqual([
            [expect.any(String), [["user1", [["Kharn", [1, 2, 3]], ["Lorgar", [4, 5]]]]]],
        ]);
    });

    it("starts over with a character for each player in a row", () => {
        const messages = [msg(1, "Kharn"), msg(2, null), msg(1, null)];

        expect(shape(messages)[0][1]).toEqual([
            ["user1", [["Kharn", [1]]]],
            ["user2", [[null, [2]]]],
            ["user1", [[null, [3]]]],
        ]);
    });

    it("keeps the keys of the groups when messages come after them", () => {
        const messages = [msg(1, null), msg(1, "Kharn"), msg(2, null)];
        const keys = (m: ChatMessage[]) => groupChat(m).flatMap(d => d.authors.map(a => [a.key, a.characters.map(c => c.key)]));

        const before = keys(messages);
        const after = keys([...messages, msg(2, null), msg(1, null)]);

        expect(after.slice(0, 2)).toEqual(before);
    });

    it("skips a message with a date it cannot read", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const messages = [msg(1, null, "not a date"), msg(1, null)];

        expect(shape(messages)[0][1]).toEqual([["user1", [[null, [2]]]]]);
        vi.restoreAllMocks();
    });
});

describe("the input history", () => {
    beforeEach(() => sessionStorage.clear());

    it("keeps what was sent in the room, once in a row, the last 50", () => {
        rememberInput(5, " hello ");
        rememberInput(5, "hello");
        rememberInput(5, "  ");
        rememberInput(6, "other room");

        expect(readInputHistory(5)).toEqual(["hello"]);
        expect(sessionStorage.getItem("chat_history_room_6")).toBe('["other room"]');

        for (let i = 0; i < 60; i++) rememberInput(5, `m${i}`);

        expect(readInputHistory(5)).toHaveLength(50);
        expect(readInputHistory(5).at(-1)).toBe("m59");
    });
});
