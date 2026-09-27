import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    answerConfirm, changeFolderVisibility, changePlayerRole, changeSheetVisibility, closeModal, confirm, createCharacter,
    createInviteLink, deleteCharacter, deleteFolder, importSheet, kickPlayer, moveSheetToFolder, openImportModal,
    openInviteModal, renameFolder, reorderFolders, rollPreset, rollStandardDice, sendChat, setDiceAmount, setDiceModifier,
    setDicePreset, setRollAgainst, toggleRollAgainst,
} from "./actions";
import { confirmMessage, dicePresets, diceSettings, folders, initRoomState, modals, players, sheets } from "./state";
import { readInputHistory } from "./chat";
import { readDiceSettings } from "./dice";
import type { RoomPayload } from "./payload.gen";

const closed = { invite: false, import: false, kicked: false, connectionLost: false };

beforeEach(() => {
    modals.value = closed;
    initRoomState({
        roomId: 5,
        csrfToken: "token",
        inviteLink: "",
        players: [{ id: 1, name: "GM", role: "gamemaster", joinedAt: "", folders: [], sheets: [] }],
        chat: { messages: [], hasMore: false },
        commands: [],
        dicePresets: [{ slot: 1, notation: "2d10+5" }],
    } as unknown as RoomPayload);
});

afterEach(() => {
    answerConfirm(false);
    vi.unstubAllGlobals();
});

function recordSent(): object[] {
    const sent: object[] = [];
    const listener = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));
    beforeEach(() => document.addEventListener("room:sendMessage", listener));
    afterEach(() => {
        document.removeEventListener("room:sendMessage", listener);
        sent.length = 0;
    });
    return sent;
}

describe("confirm", () => {
    it("resolves with the answer and closes", async () => {
        const answer = confirm("Delete Kharn?");
        expect(confirmMessage.value).toBe("Delete Kharn?");

        answerConfirm(true);

        await expect(answer).resolves.toBe(true);
        expect(confirmMessage.value).toBeNull();
    });

    it("answers no to a question that a new one replaces", async () => {
        const first = confirm("First?");
        const second = confirm("Second?");

        await expect(first).resolves.toBe(false);
        expect(confirmMessage.value).toBe("Second?");
        answerConfirm(true);
        await expect(second).resolves.toBe(true);
    });
});

describe("closing a modal", () => {
    it("answers an open confirm no and leaves the modal under it", async () => {
        openImportModal();
        const answer = confirm("Please select a file to import");

        closeModal();

        await expect(answer).resolves.toBe(false);
        expect(modals.value.import).toBe(true);
    });

    it("closes invite and import, not kicked or connection lost", () => {
        openInviteModal();
        openImportModal();
        modals.value = { ...modals.value, kicked: true, connectionLost: true };

        closeModal();

        expect(modals.value).toEqual({ invite: false, import: false, kicked: true, connectionLost: true });
    });
});

describe("a new invite link", () => {
    const sent = recordSent();

    it("is asked for with its limits", () => {
        createInviteLink(7, null);

        expect(sent).toEqual([{ type: "newInviteLink", expiresInDays: 7, maxUses: null, eventID: expect.any(String) }]);
    });
});

describe("importing a sheet", () => {
    it("asks for a file when none is picked", async () => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);

        const done = importSheet(undefined);

        expect(confirmMessage.value).toBe("Please select a file to import");
        answerConfirm(true);
        await done;
        expect(fetch).not.toHaveBeenCalled();
    });

    it("posts the file with the room and the CSRF token, then closes", async () => {
        const fetch = vi.fn(async () => new Response(null, { status: 200 }));
        vi.stubGlobal("fetch", fetch);
        openImportModal();
        const file = new File(["{}"], "kharn.json", { type: "application/json" });

        await importSheet(file);

        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        const form = init.body as FormData;
        expect([url, init.method]).toEqual(["/sheet/import", "POST"]);
        expect([form.get("csrf_token"), form.get("room_id"), (form.get("sheet_file") as File).name]).toEqual(["token", "5", "kharn.json"]);
        expect(modals.value.import).toBe(false);
    });

    it("says so when the server refuses the file and keeps the modal", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
        openImportModal();

        const done = importSheet(new File(["{}"], "bad.json"));
        await vi.waitFor(() => expect(confirmMessage.value).toMatch(/^Failed to import/));
        answerConfirm(true);
        await done;

        expect(modals.value.import).toBe(true);
    });
});

describe("a chat message", () => {
    const sent = recordSent();

    beforeEach(() => sessionStorage.clear());

    it("is sent with the character only when there is one, and kept for ↑", () => {
        sendChat("hello");
        sendChat("/r d10", "Kharn");
        sendChat("/r d5", null);

        expect(sent).toEqual([
            { type: "chatMessage", messageBody: "hello", eventID: expect.any(String) },
            { type: "chatMessage", messageBody: "/r d10", characterName: "Kharn", eventID: expect.any(String) },
            { type: "chatMessage", messageBody: "/r d5", eventID: expect.any(String) },
        ]);
        expect(readInputHistory(5)).toEqual(["hello", "/r d10", "/r d5"]);
    });
});

describe("the dice roller", () => {
    const sent = recordSent();
    const bodies = () => sent.map(m => (m as { messageBody?: string }).messageBody);

    beforeEach(() => localStorage.clear());

    it("rolls with its settings and saves them for the room", () => {
        setDiceAmount(3);
        setDiceModifier(-20);
        rollStandardDice(10);
        setRollAgainst(2, "45");
        toggleRollAgainst(2);
        rollStandardDice(100);
        toggleRollAgainst(2);
        rollStandardDice(5);

        expect(bodies()).toEqual(["/r 3d10-20", "/r 3d100 vs 25", "/r 3d5-20"]);
        expect(readDiceSettings(5)).toEqual(diceSettings.value);
        expect(diceSettings.value).toEqual({ amount: 3, modifier: -20, rollAgainst: ["", "", "45", ""], selected: null });
    });

    it("rolls a preset from the page, not an empty one", () => {
        rollPreset(0);
        rollPreset(1);

        expect(bodies()).toEqual(["/r 2d10+5"]);
    });

    it("tells the server a preset once the player stops typing", () => {
        vi.useFakeTimers();
        try {
            setDicePreset(1, "d");
            vi.advanceTimersByTime(400);
            setDicePreset(1, "d100 ");
            setDicePreset(2, "d5");
            expect(dicePresets.value).toEqual(["2d10+5", "d100 ", "d5", "", ""]);
            vi.advanceTimersByTime(499);
            expect(sent).toEqual([]);

            vi.advanceTimersByTime(1);

            expect(sent).toEqual([
                { type: "dicePresetUpdated", slotNumber: 2, diceNotation: "d100", eventID: expect.any(String) },
                { type: "dicePresetUpdated", slotNumber: 3, diceNotation: "d5", eventID: expect.any(String) },
            ]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("the character list", () => {
    const sent = recordSent();

    beforeEach(() => {
        initRoomState({
            roomId: 5,
            csrfToken: "",
            inviteLink: "",
            players: [
                {
                    id: 1, name: "GM", role: "gamemaster", joinedAt: "",
                    folders: [
                        { id: 10, name: "Heretics", visibility: "everyone_can_view", sortOrder: 0 },
                        { id: 11, name: "Empty", visibility: "hide_from_players", sortOrder: 1 },
                        { id: 12, name: "Last", visibility: "everyone_can_view", sortOrder: 2 },
                    ],
                    sheets: [
                        { id: 100, name: "Kharn", kind: "black_crusade", visibility: "everyone_can_view", folderId: 10, createdAt: "", updatedAt: "" },
                        { id: 101, name: "", kind: "black_crusade", visibility: "everyone_can_view", folderId: null, createdAt: "", updatedAt: "" },
                    ],
                },
                { id: 2, name: "Player", role: "player", joinedAt: "", folders: [{ id: 20, name: "Theirs", visibility: "everyone_can_view", sortOrder: 0 }], sheets: [] },
            ],
            chat: { messages: [], hasMore: false },
            commands: [],
            dicePresets: [],
            sheetKinds: [],
        } as unknown as RoomPayload);
    });

    const folder = (id: number) => folders.value.find(f => f.id === id)!;
    const sheet = (id: number) => sheets.value.find(s => s.id === id)!;

    it("asks for a sheet of the kind", () => {
        createCharacter("pathfinder_crusade");

        expect(sent).toEqual([{ type: "newCharacter", kind: "pathfinder_crusade", eventID: expect.any(String) }]);
    });

    it("deletes a sheet when the player says OK, naming it as the list does", async () => {
        const no = deleteCharacter(101);
        expect(confirmMessage.value).toBe("Delete _____?");
        answerConfirm(false);
        await no;
        expect(sent).toEqual([]);

        const yes = deleteCharacter(100);
        expect(confirmMessage.value).toBe("Delete Kharn?");
        answerConfirm(true);
        await yes;
        expect(sent).toEqual([{ type: "deleteCharacter", sheetID: "100", eventID: expect.any(String) }]);
    });

    it("changes a sheet's visibility at once", () => {
        changeSheetVisibility(101, "hide_from_players");

        expect(sheet(101).visibility).toBe("hide_from_players");
        expect(sent).toEqual([{ type: "changeSheetVisibility", sheetID: "101", visibility: "hide_from_players", eventID: expect.any(String) }]);
    });

    it("moves a sheet into a folder and out, not into the folder it is in or one that is gone", () => {
        moveSheetToFolder(101, 10);
        moveSheetToFolder(101, 10);
        moveSheetToFolder(100, 99);
        moveSheetToFolder(100, null);

        expect([sheet(100).folderId, sheet(101).folderId]).toEqual([null, 10]);
        expect(sent).toEqual([
            { type: "moveSheetToFolder", sheetId: 101, folderId: 10, eventID: expect.any(String) },
            { type: "moveSheetToFolder", sheetId: 100, folderId: null, eventID: expect.any(String) },
        ]);
    });

    it("renames a folder once the player stops typing, and only then in the state", () => {
        vi.useFakeTimers();
        renameFolder(10, "Her");
        vi.advanceTimersByTime(300);
        renameFolder(10, "Heresy");
        vi.advanceTimersByTime(499);
        expect(folder(10).name).toBe("Heretics");
        expect(sent).toEqual([]);

        vi.advanceTimersByTime(1);

        expect(folder(10).name).toBe("Heresy");
        expect(sent).toEqual([{ type: "updateFolder", folderId: 10, name: "Heresy", visibility: "everyone_can_view", eventID: expect.any(String) }]);
        vi.useRealTimers();
    });

    it("changes a folder's visibility at once, with its name", () => {
        changeFolderVisibility(10, "everyone_can_see");

        expect(folder(10).visibility).toBe("everyone_can_see");
        expect(sent).toEqual([{ type: "updateFolder", folderId: 10, name: "Heretics", visibility: "everyone_can_see", eventID: expect.any(String) }]);
    });

    it("deletes a folder when the player says OK, telling where its sheets go", async () => {
        const full = deleteFolder(10);
        expect(confirmMessage.value).toBe('Delete folder "Heretics"?\n\n1 character sheet(s) will be moved to the default area.');
        answerConfirm(true);
        await full;

        const empty = deleteFolder(11);
        expect(confirmMessage.value).toBe('Delete folder "Empty"?');
        answerConfirm(false);
        await empty;

        expect(sent).toEqual([{ type: "deleteFolder", folderId: 10, eventID: expect.any(String) }]);
    });

    it("reorders my folders as dropped; folders missing from the drop go last", () => {
        reorderFolders([12, 10]);

        expect([10, 11, 12, 20].map(id => folder(id).sortOrder)).toEqual([1, 2, 0, 0]);
        expect(sent).toEqual([{ type: "reorderFolders", folderIds: [12, 10, 11], eventID: expect.any(String) }]);
    });

    it("sends no order when the drop left it as it was", () => {
        reorderFolders([10, 11, 12]);

        expect(sent).toEqual([]);
    });

    it("kicks a player when the gamemaster says OK", async () => {
        const kick = kickPlayer(2);
        expect(confirmMessage.value).toBe("Kick Player?");
        answerConfirm(true);
        await kick;

        expect(sent).toEqual([{ type: "kickPlayer", userID: 2, eventID: expect.any(String) }]);
        expect(players.value.map(p => p.id)).toEqual([1, 2]);
    });

    it("changes a role at once: the server tells only the others", () => {
        changePlayerRole(2, "moderator");

        expect(players.value[1].role).toBe("moderator");
        expect(sent).toEqual([{ type: "changePlayerRole", userID: 2, role: "moderator", eventID: expect.any(String) }]);
    });
});
