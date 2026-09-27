import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    answerConfirm, closeModal, confirm, createInviteLink, importSheet, openImportModal, openInviteModal, rollPreset,
    rollStandardDice, sendChat, setDiceAmount, setDiceModifier, setDicePreset, setRollAgainst, toggleRollAgainst,
} from "./actions";
import { confirmMessage, dicePresets, diceSettings, initRoomState, modals } from "./state";
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
