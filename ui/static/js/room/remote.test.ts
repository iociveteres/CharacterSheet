import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listenRemote } from "./remote";
import { chat, dicePresets, folders, inviteLink, me, modals, players, sheets, toasts } from "./state";
import { freezeList, thawList } from "./dragFreeze";
import type { Folder, Sheet } from "./characters";
import { changeFolderVisibility, loadEarlierMessages } from "./actions";
import { applyRemote, loadState, teardownSheet, testScope, testState } from "../sheet/components/testUtils";
import { announceCharacterName } from "../sheet/characterName";
import { createSheetRolls } from "../sheet/rollEvents";

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

    const rollsOf = (sheetId: string, name: string) =>
        createSheetRolls(sheetId, loadState({ characterInfo: { characterName: name } }), testScope);
    const message = (eventID: unknown, extra: object = {}) =>
        ({ type: "chatMessage", eventID, messageId: 1, userId: 1, userName: "Me", messageBody: "", created: "", ...extra });

    it("goes to the chat as a command", () => {
        const rolls = rollsOf("7", "Kharn");
        void rolls.versus(40, 1, "Awareness");
        void rolls.exact("2d10", "");

        expect(sent.map(m => [m.type, m.messageBody])).toEqual([
            ["chatMessage", "/r d100 vs 40 [+1]\n>> Awareness"],
            ["chatMessage", "/r 2d10"],
        ]);
    });

    it("answers a test with what it came to when its message is back", async () => {
        const rolls = rollsOf("7", "Kharn");
        const outcome = { roll: 33, target: 40, success: true, degrees: 1, crit: false, doubles: true };
        const test = rolls.versus(40, 0, "Smite");
        const other = rolls.versus(50, 0, "");
        receive(message("someone else's"));
        receive(message(sent[0].eventID, { versus: outcome }));
        receive(message(sent[1].eventID));

        expect(await test).toEqual(outcome);
        expect(await other).toBeNull();
    });

    it("answers a dice roll with its total when its message is back", async () => {
        const rolls = rollsOf("7", "Kharn");
        const roll = rolls.exact("1d10+7", "Initiative");
        receive(message(sent[0].eventID, { commandResult: "1d10+7 = 12" }));

        expect(await roll).toBe(12);
    });

    it("gives nothing for a roll of a sheet closed before its message is back", async () => {
        const rolls = rollsOf("7", "Kharn");
        const test = rolls.versus(40, 0, "");
        const roll = rolls.exact("1d10", "");
        teardownSheet();
        receive(message(sent[0].eventID, { versus: { roll: 1, target: 40, success: true, degrees: 4, crit: true, doubles: false } }));
        receive(message(sent[1].eventID, { commandResult: "1d10 = 4" }));

        expect(await test).toBeNull();
        expect(await roll).toBeNull();
    });

    it("is signed with the character of its own sheet, as it is named when rolled", () => {
        const kharn = rollsOf("7", "Kharn");
        const lorgar = rollsOf("8", "  Lorgar ");
        const nameless = rollsOf("9", " ");
        void kharn.versus(40, 0, "");
        void lorgar.exact("1d10", "");
        void nameless.exact("1d10", "");

        expect(sent.map(m => m.characterName ?? null)).toEqual(["Kharn", "Lorgar", null]);
    });

    it("goes back to the sheet that rolled it, when two sheets of one name roll", async () => {
        const first = rollsOf("7", "Ork Boy");
        const second = rollsOf("8", "Ork Boy");
        const a = first.exact("1d10", "Initiative");
        const b = second.exact("1d10", "Initiative");
        receive(message(sent[1].eventID, { commandResult: "1d10 = 9" }));
        receive(message(sent[0].eventID, { commandResult: "1d10 = 2" }));

        expect([await a, await b]).toEqual([2, 9]);
    });

    it("gives nothing for a roll the server refuses", async () => {
        const rolls = rollsOf("7", "Kharn");
        const test = rolls.versus(40, 0, "");
        const roll = rolls.exact("1d10", "");
        receive({ type: "response", eventID: sent[0].eventID, OK: true });
        receive({ type: "response", eventID: sent[1].eventID, OK: false, code: "internal" });

        expect(await roll).toBeNull();
        // Only an error ends the wait: the test still gets its message.
        receive(message(sent[0].eventID, { versus: { roll: 12, target: 40, success: true, degrees: 3, crit: false, doubles: false } }));
        expect((await test)?.roll).toBe(12);
    });

    it("gives nothing for the rolls on their way when the connection drops, or sent while it was down", async () => {
        const rolls = rollsOf("7", "Kharn");
        const before = rolls.exact("1d10", "");
        document.dispatchEvent(new CustomEvent("ws:disconnected"));
        const during = rolls.exact("1d10", "");
        document.dispatchEvent(new CustomEvent("ws:reconnected"));

        expect([await before, await during]).toEqual([null, null]);
    });
});

describe("the character list", () => {
    const folder = (id: number, ownerId: number, sortOrder = 0): Folder =>
        ({ id, ownerId, name: `f${id}`, visibility: "everyone_can_view", sortOrder });
    const sheet = (id: number, ownerId: number, folderId: number | null = null): Sheet =>
        ({ id, ownerId, name: `s${id}`, kind: "black_crusade", visibility: "everyone_can_view", folderId, createdAt: "", updatedAt: "" });
    const sheetIds = () => sheets.value.map(s => s.id);

    beforeEach(() => {
        players.value = [
            { id: 1, name: "Me", role: "player", joinedAt: "" },
            { id: 2, name: "Other", role: "player", joinedAt: "" },
        ];
        folders.value = [folder(10, 1), folder(20, 2, 0), folder(21, 2, 1)];
        sheets.value = [sheet(100, 1), sheet(200, 2, 20), sheet(201, 2)];
    });

    it("puts a new sheet first, once", () => {
        const msg = { type: "newCharacterItem", eventID: "e", userID: 2, sheetID: 202, name: "", kind: "pathfinder_crusade", created: "c", updated: "u" };
        receive(msg);
        receive(msg);

        expect(sheets.value[0]).toEqual({
            id: 202, ownerId: 2, name: "", kind: "pathfinder_crusade", visibility: "everyone_can_view", folderId: null, createdAt: "c", updatedAt: "u",
        });
        expect(sheetIds()).toEqual([202, 100, 200, 201]);
    });

    it("drops a deleted sheet", () => {
        receive({ type: "deleteCharacter", eventID: "e", sheetID: "200" });

        expect(sheetIds()).toEqual([100, 201]);
    });

    it("renames a sheet on a name change of any sheet, and only on the name", () => {
        receive({ type: "change", eventID: "e", sheetID: "201", path: "characterInfo.characterName", change: "Lorgar" });
        receive({ type: "change", eventID: "e", sheetID: "100", path: "characterInfo.race", change: "Human" });

        expect(sheets.value.map(s => s.name)).toEqual(["s100", "s200", "Lorgar"]);
    });

    it("renames the open sheet as the sheet tells it", () => {
        loadState({ characterInfo: { characterName: "Kharn" } });
        announceCharacterName({ sheetId: "100", state: testState(), scope: testScope });
        applyRemote({ type: "change", path: "characterInfo.characterName", change: "Abaddon" });
        teardownSheet();

        expect(sheets.value[0].name).toBe("Abaddon");
    });

    it("takes a sheet's visibility and folder", () => {
        receive({ type: "changeSheetVisibility", eventID: "e", sheetID: "201", visibility: "hide_from_players" });
        receive({ type: "moveSheetToFolder", eventID: "e", sheetId: 201, folderId: 21 });
        receive({ type: "moveSheetToFolder", eventID: "e", sheetId: 200, folderId: null });

        expect(sheets.value.map(s => [s.id, s.visibility, s.folderId])).toEqual([
            [100, "everyone_can_view", null],
            [200, "everyone_can_view", null],
            [201, "hide_from_players", 21],
        ]);
    });

    it("adds a created folder once and takes a folder's name and visibility", () => {
        const created = { type: "folderCreated", eventID: "e", folderId: 22, ownerId: 2, name: "New Folder", visibility: "everyone_can_view", sortOrder: 2, createdAt: "" };
        receive(created);
        receive(created);
        receive({ type: "updateFolder", eventID: "e", folderId: 20, name: "Renamed", visibility: "hide_from_players" });

        expect(folders.value.map(f => [f.id, f.ownerId, f.name, f.visibility, f.sortOrder])).toEqual([
            [10, 1, "f10", "everyone_can_view", 0],
            [20, 2, "Renamed", "hide_from_players", 0],
            [21, 2, "f21", "everyone_can_view", 1],
            [22, 2, "New Folder", "everyone_can_view", 2],
        ]);
    });

    it("skips the echo of my folder update that a later one of mine overtook, and takes the rest", () => {
        const sent: string[] = [];
        const record = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail).eventID);
        document.addEventListener("room:sendMessage", record);
        changeFolderVisibility(10, "everyone_can_see");
        changeFolderVisibility(10, "hide_from_players");
        document.removeEventListener("room:sendMessage", record);
        const echo = (eventID: string, name: string, visibility: string) =>
            receive({ type: "updateFolder", eventID, folderId: 10, name, visibility });
        const f10 = () => { const f = folders.value.find(f => f.id === 10)!; return [f.name, f.visibility]; };

        echo(sent[0], "f10", "everyone_can_see");
        expect(f10()).toEqual(["f10", "hide_from_players"]);
        // Another tab of mine, which the server handled before my last update.
        echo("other-tab", "Elsewhere", "everyone_can_view");
        expect(f10()).toEqual(["Elsewhere", "everyone_can_view"]);
        echo(sent[1], "f10", "hide_from_players");
        expect(f10()).toEqual(["f10", "hide_from_players"]);
    });

    it("takes the sheets out of a deleted folder", () => {
        receive({ type: "deleteFolder", eventID: "e", folderId: 20 });

        expect(folders.value.map(f => f.id)).toEqual([10, 21]);
        expect(sheets.value.find(s => s.id === 200)!.folderId).toBeNull();
    });

    it("reorders the folders of another player", () => {
        receive({ type: "reorderFolders", eventID: "e", folderIds: [21, 20] });

        expect(folders.value.map(f => [f.id, f.sortOrder])).toEqual([[10, 0], [20, 1], [21, 0]]);
    });

    it("adds a new player once, as a player", () => {
        const msg = { type: "newPlayer", eventID: "e", userID: 3, name: "New", joined: "2026-09-27T10:00:00Z" };
        receive(msg);
        receive(msg);

        expect(players.value.slice(2)).toEqual([{ id: 3, name: "New", role: "player", joinedAt: "2026-09-27T10:00:00Z" }]);
    });

    it("drops a kicked player with their folders and sheets", () => {
        receive({ type: "kickPlayer", eventID: "e", userID: 2 });

        expect(players.value.map(p => p.id)).toEqual([1]);
        expect(folders.value.map(f => f.id)).toEqual([10]);
        expect(sheetIds()).toEqual([100]);
    });

    it("changes the role of another player", () => {
        receive({ type: "changePlayerRole", eventID: "e", userID: 2, role: "moderator" });

        expect(players.value.map(p => p.role)).toEqual(["player", "moderator"]);
    });

    it("waits while the player drags in it, then changes in the order the changes came", () => {
        freezeList();
        receive({ type: "folderCreated", eventID: "e", folderId: 22, ownerId: 2, name: "New Folder", visibility: "everyone_can_view", sortOrder: 2, createdAt: "" });
        receive({ type: "moveSheetToFolder", eventID: "e", sheetId: 201, folderId: 22 });
        receive({ type: "kickPlayer", eventID: "e", userID: 1 });

        expect(folders.value.map(f => f.id)).toEqual([10, 20, 21]);
        expect(sheets.value.find(s => s.id === 201)!.folderId).toBeNull();
        // The kick of me is no change to the list.
        expect(modals.value.kicked).toBe(true);

        thawList().forEach(op => op());

        expect(folders.value.map(f => f.id)).toEqual([10, 20, 21, 22]);
        expect(sheets.value.find(s => s.id === 201)!.folderId).toBe(22);
        expect(players.value.map(p => p.id)).toEqual([1, 2]);
    });
});
