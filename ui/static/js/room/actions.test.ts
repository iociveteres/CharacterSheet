import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerConfirm, closeModal, confirm, createInviteLink, importSheet, openImportModal, openInviteModal } from "./actions";
import { confirmMessage, initRoomState, modals } from "./state";
import type { RoomPayload } from "./payload.gen";

const closed = { invite: false, import: false, kicked: false, connectionLost: false };

beforeEach(() => {
    modals.value = closed;
    initRoomState({
        roomId: 5,
        csrfToken: "token",
        inviteLink: "",
        players: [{ id: 1, name: "GM", role: "gamemaster", joinedAt: "", folders: [], sheets: [] }],
    } as unknown as RoomPayload);
});

afterEach(() => {
    answerConfirm(false);
    vi.unstubAllGlobals();
});

function recordSent(): object[] {
    const sent: object[] = [];
    const listener = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));
    document.addEventListener("room:sendMessage", listener);
    afterEach(() => document.removeEventListener("room:sendMessage", listener));
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
