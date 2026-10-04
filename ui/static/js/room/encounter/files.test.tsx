import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { RoomPayload } from "../payload.gen";
import type { EncounterPayload } from "./messages";
import type { EncounterLoadResult, EncounterParticipant, EncounterState } from "./types.gen";
import { encounter } from "./state";
import { applyEncounter, initEncounter, setEncounterList } from "./actions";
import { InitiativeColumn } from "./components/InitiativeColumn";
import { confirmMessage, initRoomState, toasts } from "../state";
import { answerConfirm } from "../actions";

const participant = (id: number, groupId: number, sheetId: number, name: string, npc: boolean): EncounterParticipant =>
    ({ id, groupId, sheetId, npc, displayName: null, name, sourceCreatureId: null, sourceCreatureName: null, sourceLabel: null });

const state = (participants: EncounterParticipant[]): EncounterState => ({
    id: 1, roomId: 5, name: "Ambush", round: 2, currentGroupId: null, shown: false, initiativeView: null, version: 1, updatedAt: "",
    groups: participants.map((p, i) => ({ id: p.groupId, position: i, name: null })),
    participants,
});

// A character and an orc.
const opened: EncounterPayload = {
    encounter: state([participant(1, 10, 100, "Ulrich", false), participant(2, 11, 200, "Ork Boy", true)]),
    sheets: [],
};
// The file's two gretchin in place of the orc.
const replaced = { ...state([participant(1, 10, 100, "Ulrich", false), participant(3, 12, 300, "Grot", true), participant(4, 13, 301, "Snotling", true)]), version: 2 };
// What the socket brought before the answer to late.json: the gretchin renamed.
const renamed = { ...state([participant(1, 10, 100, "Ulrich", false), participant(3, 12, 300, "Grot Boss", true), participant(4, 13, 301, "Snotling", true)]), version: 3 };

/** The requests to the server: path, method and the files and fields of the form. */
const requests: { url: string; method: string; form: Record<string, string[]> }[] = [];

async function server(url: string, init: RequestInit = {}): Promise<Response> {
    const form: Record<string, string[]> = {};
    if (init.body instanceof FormData) {
        for (const [key, value] of init.body.entries()) (form[key] ??= []).push(value instanceof File ? value.name : value);
    }
    requests.push({ url, method: init.method ?? "GET", form });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/encounter/1") return json(opened);
    if (url === "/encounters/load") {
        // The third file did not fit into the quota: the fourth was not tried.
        const results: EncounterLoadResult[] = [
            { file: "raid.json", encounterId: 2, name: "Raid", npcs: 4 },
            { file: "notes.txt", npcs: 0, error: "invalid" },
            { file: "big.json", npcs: 0, error: "quota", message: "NPCs and creatures take 4.9 of 5 MB; this needs 1.0 MB more." },
        ];
        return json(results);
    }
    if (url === "/encounter/1/npcs") {
        if (form.file?.[0] === "notes.txt") return new Response("Bad Request", { status: 400 });
        if (form.file?.[0] === "late.json") applyEncounter(renamed);
        return json(replaced);
    }
    return new Response("Not Found", { status: 404 });
}

const box = document.createElement("div");
const $ = (selector: string) => box.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...box.querySelectorAll<HTMLElement>(selector)];

function click(el: HTMLElement | null | undefined): void {
    if (!el) throw new Error("Nothing to click");
    act(() => el.click());
}

/** Picks the files in a file input, as the dialog of the browser does. */
function pick(input: HTMLElement | null, names: string[]): void {
    if (!input) throw new Error("No file input");
    const files = names.map(name => new File(["{}"], name, { type: "application/json" }));
    Object.defineProperty(input, "files", { value: files, configurable: true });
    act(() => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

const menu = () => {
    click($(".encounter-menu-btn"));
    return $$(".encounter-menu [role=menuitem]").map(b => b.textContent!.trim());
};

beforeAll(async () => {
    document.body.appendChild(box);
    vi.stubGlobal("fetch", vi.fn(server));
    initRoomState({
        roomId: 5, csrfToken: "token", inviteLink: "", players: [], chat: { messages: [], hasMore: false }, commands: [], dicePresets: [],
        sheetKinds: [{ kind: "black_crusade", label: "Black Crusade" }],
    } as unknown as RoomPayload);
    initEncounter({ encounters: { encounters: [{ id: 1, name: "Ambush", updatedAt: "" }], shownEncounterId: null }, initiativeView: null } as unknown as RoomPayload);
    await vi.waitFor(() => expect(encounter.value?.id).toBe(1));
    act(() => render(<InitiativeColumn />, box));
});

afterAll(() => {
    render(null, box);
    vi.unstubAllGlobals();
});

beforeEach(() => {
    requests.length = 0;
});

describe("the files of an encounter", () => {
    it("are in the menu of the open encounter", () => {
        expect(menu()).toEqual(expect.arrayContaining(["Load from files…", "Export", "Replace NPCs from file…"]));
        const link = $(".encounter-export-link") as HTMLAnchorElement;
        expect(link.getAttribute("href")).toBe("/encounter/1/export");
        expect(link.hasAttribute("download")).toBe(true);
        const followed = vi.fn((e: Event) => e.preventDefault());
        link.addEventListener("click", followed);
        click($(".encounter-export"));
        expect(followed).toHaveBeenCalledOnce();
        expect($(".encounter-menu")).toBeNull();
    });

    it("loads every file as a new encounter and tells how each went, the open one staying open", async () => {
        pick($(".encounter-load-input"), ["raid.json", "notes.txt", "big.json", "ambush.json"]);
        await vi.waitFor(() => expect(requests.find(r => r.url === "/encounters/load")).toBeDefined());
        expect(requests.find(r => r.url === "/encounters/load")).toEqual({
            url: "/encounters/load", method: "POST",
            form: { room_id: ["5"], files: ["raid.json", "notes.txt", "big.json", "ambush.json"] },
        });
        await vi.waitFor(() => expect(toasts.value.at(-1)?.message).toBe([
            'raid.json: "Raid", 4 NPCs',
            "notes.txt: not an encounter file",
            "big.json: not enough room: NPCs and creatures take 4.9 of 5 MB; this needs 1.0 MB more.",
            "ambush.json: not uploaded",
        ].join("\n")));
        expect(encounter.value?.id).toBe(1);
        // The input is emptied: the same file can be picked again.
        expect(($(".encounter-load-input") as HTMLInputElement).value).toBe("");
    });

    it("replaces the NPCs of the open encounter once the gamemaster agrees", async () => {
        pick($(".encounter-replace-input"), ["gretchin.json"]);
        expect(confirmMessage.value).toBe('Replace the 1 NPC of "Ambush" with the NPCs of gretchin.json?\n\nCharacters stay.');
        act(() => answerConfirm(true));
        await vi.waitFor(() => expect(encounter.value?.participants.map(p => p.name)).toEqual(["Ulrich", "Grot", "Snotling"]));
        expect(requests.find(r => r.url === "/encounter/1/npcs")).toEqual({ url: "/encounter/1/npcs", method: "POST", form: { file: ["gretchin.json"] } });
    });

    it("keeps a newer state the socket brought before the answer", async () => {
        pick($(".encounter-replace-input"), ["late.json"]);
        act(() => answerConfirm(true));
        await vi.waitFor(() => expect(requests.find(r => r.url === "/encounter/1/npcs")).toBeDefined());
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(encounter.value?.version).toBe(3);
        expect(encounter.value?.participants.map(p => p.name)).toEqual(["Ulrich", "Grot Boss", "Snotling"]);
    });

    it("sends nothing when the gamemaster does not agree", async () => {
        pick($(".encounter-replace-input"), ["gretchin.json"]);
        act(() => answerConfirm(false));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(requests).toEqual([]);
    });

    it("tells of a file that is no encounter", async () => {
        pick($(".encounter-replace-input"), ["notes.txt"]);
        act(() => answerConfirm(true));
        await vi.waitFor(() => expect(toasts.value.at(-1)?.message).toBe("notes.txt: not an encounter file"));
    });

    it("loads files when there is no encounter yet", () => {
        act(() => setEncounterList({ encounters: [], shownEncounterId: null }));
        expect(encounter.value).toBeNull();
        expect($$(".encounter-empty button").map(b => b.textContent)).toEqual(["New encounter", "Load from files…"]);
        expect($(".encounter-load-input")).not.toBeNull();
        expect($(".encounter-replace-input")).not.toBeNull();
    });
});
