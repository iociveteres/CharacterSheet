import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listenRemote } from "./remote";
import { characterName, chat, dicePresets, inviteLink, me, modals, players, toasts } from "./state";
import { loadEarlierMessages } from "./actions";
import { loadState } from "../sheet/components/testUtils";
import { teardownSheet } from "../sheet/lifecycle";
import { applyRemoteToState } from "../sheet/state/remote";
import { announceCharacterName } from "../sheet/characterName";

const closed = { invite: false, import: false, kicked: false, connectionLost: false };

const receive = (msg: { type: string; [key: string]: unknown }) => document.dispatchEvent(new CustomEvent(`ws:${msg.type}`, { detail: msg }));

beforeAll(() => listenRemote());

beforeEach(() => {
    players.value = [{ id: 1, name: "Me", role: "player", joinedAt: "" }];
    modals.value = closed;
});

afterEach(() => vi.useRealTimers());

describe("a kick", () => {
    it("of me shows the kicked modal", () => {
        receive({ type: "kickPlayer", eventID: "e", userID: 1 });

        expect(modals.value.kicked).toBe(true);
    });

    it("of another player leaves the page as it is", () => {
        receive({ type: "kickPlayer", eventID: "e", userID: 2 });

        expect(modals.value).toEqual(closed);
    });
});

describe("a role change", () => {
    it("of me changes my role", () => {
        receive({ type: "changePlayerRole", eventID: "e", userID: 1, role: "moderator" });

        expect(me.value).toEqual({ id: 1, role: "moderator" });
    });

    it("of me to a player closes the invite modal", () => {
        players.value = [{ id: 1, name: "Me", role: "moderator", joinedAt: "" }];
        modals.value = { ...closed, invite: true };

        receive({ type: "changePlayerRole", eventID: "e", userID: 1, role: "player" });

        expect(modals.value).toEqual(closed);
    });

    it("of another player leaves mine", () => {
        receive({ type: "changePlayerRole", eventID: "e", userID: 2, role: "moderator" });

        expect(me.value.role).toBe("player");
    });
});

it("a new invite link replaces the shown one", () => {
    receive({ type: "newInviteLink", link: "http://localhost/invite/abc" });

    expect(inviteLink.value).toBe("http://localhost/invite/abc");
});

it("a lost connection shows its modal", () => {
    window.dispatchEvent(new CustomEvent("ws:connectionLost"));

    expect(modals.value.connectionLost).toBe(true);
});

describe("toasts", () => {
    const messages = () => toasts.value.map(t => t.message);

    it("show a notice of the sheet for five seconds, a repeated one once", () => {
        vi.useFakeTimers();
        const notice = (message: string) => document.dispatchEvent(new CustomEvent("sheet:notice", { detail: { message } }));

        notice("Not saved");
        vi.advanceTimersByTime(3000);
        notice("Other");
        notice("Not saved");
        expect(messages()).toEqual(["Other", "Not saved"]);

        // The repeated notice counts its five seconds from the repeat.
        vi.advanceTimersByTime(2500);
        expect(messages()).toEqual(["Other", "Not saved"]);
        vi.advanceTimersByTime(3000);
        expect(messages()).toEqual([]);
    });
});

function recordSent(): { type: string; [key: string]: unknown }[] {
    const sent: { type: string; [key: string]: unknown }[] = [];
    const listener = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));
    beforeEach(() => document.addEventListener("room:sendMessage", listener));
    afterEach(() => {
        document.removeEventListener("room:sendMessage", listener);
        sent.length = 0;
    });
    return sent;
}

describe("the chat", () => {
    const ids = () => chat.value.messages.map(m => m.id);

    beforeEach(() => {
        chat.value = { messages: [], hasMore: false };
    });

    it("adds a new message at the end, without the fields the server left out", () => {
        receive({ type: "chatMessage", eventID: "e", messageId: 7, userId: 2, userName: "Player", messageBody: "hi", created: "2026-09-27T10:00:00Z" });

        expect(chat.value.messages).toEqual([{
            id: 7, userId: 2, userName: "Player", messageBody: "hi", commandResult: null, characterName: null, createdAt: "2026-09-27T10:00:00Z",
        }]);
    });

    it("drops a message the gamemaster deleted", () => {
        for (const id of [1, 2, 3]) {
            receive({ type: "chatMessage", eventID: "e", messageId: id, userId: 1, userName: "GM", messageBody: "m", created: "2026-09-27T10:00:00Z" });
        }

        receive({ type: "deleteMessage", eventID: "e", messageId: 2 });

        expect(ids()).toEqual([1, 3]);
    });

    it("has no more history after an empty page", () => {
        chat.value = { messages: [], hasMore: true };

        receive({ type: "chatHistory", eventID: "e", messagePage: { messages: null, hasMore: false } });

        expect(chat.value.hasMore).toBe(false);
    });
});

// The server's chat, newest first as GetMessagePage counts the offset.
function chatServer(count: number) {
    const messages: { id: number; roomId: number; userId: number; messageBody: string; createdAt: string }[] = [];
    const post = () => {
        const id = messages.length + 1;
        messages.push({ id, roomId: 5, userId: 1, messageBody: `m${id}`, createdAt: "2026-09-27T10:00:00Z" });
        return { type: "chatMessage", eventID: "e", messageId: id, userId: 1, userName: "GM", messageBody: `m${id}`, created: "2026-09-27T10:00:00Z" };
    };
    const page = (offset: number, limit: number) => {
        const newestFirst = [...messages].reverse();
        return {
            messages: newestFirst.slice(offset, offset + limit).reverse().map(message => ({ message, username: "GM" })),
            hasMore: newestFirst.length > offset + limit,
        };
    };
    for (let i = 0; i < count; i++) post();
    return { post, page };
}

describe("loading earlier chat messages", () => {
    const sent = recordSent();

    it("continues after the shown ones, also after new messages have come", () => {
        const server = chatServer(60);
        const first = server.page(0, 50);
        chat.value = { messages: [], hasMore: first.hasMore };
        receive({ type: "chatHistory", eventID: "e", messagePage: first });
        for (let i = 0; i < 3; i++) receive(server.post());

        loadEarlierMessages();
        const [request] = sent;
        // A message that comes before the answer moves the page by one more.
        receive(server.post());
        receive({ type: "chatHistory", eventID: "e", messagePage: server.page(request.offset as number, request.limit as number) });

        expect(chat.value.messages.map(m => m.id)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
        expect(chat.value.messages[0].userName).toBe("GM");
        expect(chat.value.hasMore).toBe(false);
    });

    it("asks nothing when there is nothing more", () => {
        chat.value = { messages: [], hasMore: false };

        loadEarlierMessages();

        expect(sent).toEqual([]);
    });
});

it("a preset from another tab of mine fills its slot", () => {
    dicePresets.value = ["", "", "", "", ""];

    receive({ type: "dicePresetUpdated", slotNumber: 3, diceNotation: "2d10+5" });
    receive({ type: "dicePresetUpdated", slotNumber: 6, diceNotation: "d5" });

    expect(dicePresets.value).toEqual(["", "", "2d10+5", "", ""]);
});

describe("a roll from the sheet", () => {
    const sent = recordSent();

    afterEach(teardownSheet);

    /** The character name a d100 test and a dice roll from the sheet are signed with. */
    function signatures() {
        sent.length = 0;
        document.dispatchEvent(new CustomEvent("sheet:rollVersus", { detail: { target: 40, bonusSuccesses: 0, label: "" } }));
        document.dispatchEvent(new CustomEvent("sheet:rollExact", { detail: { expression: "1d10", label: "" } }));
        return sent.map(m => m.characterName ?? null);
    }

    it("goes to the chat as a command", () => {
        document.dispatchEvent(new CustomEvent("sheet:rollVersus", { detail: { target: 40, bonusSuccesses: 1, label: "Awareness" } }));
        document.dispatchEvent(new CustomEvent("sheet:rollExact", { detail: { expression: "2d10", label: "" } }));

        expect(sent.map(m => [m.type, m.messageBody])).toEqual([
            ["chatMessage", "/r d100 vs 40 [+1]\n>> Awareness"],
            ["chatMessage", "/r 2d10"],
        ]);
    });

    it("is signed with the name of the open character, as the sheet tells it", () => {
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
        expect(characterName.value).toBeNull();
        expect(signatures()).toEqual([null, null]);
    });
});
