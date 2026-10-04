import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { RoomPayload } from "../payload.gen";
import type { Bestiary, BestiaryCollection, Creature } from "../../bestiary/types.gen";
import type { EncounterPayload } from "./messages";
import type { EncounterParticipant } from "./types.gen";
import { encounter, fromBestiaryOpen } from "./state";
import { initEncounter } from "./actions";
import { ParticipantColumn } from "./components/ParticipantColumn";
import { FromBestiary } from "./components/FromBestiary";
import { SaveToCollection } from "../components/SaveToCollection";
import { AddVariant } from "../components/AddVariant";
import { initRoomState, toasts } from "../state";
import { savingSheet } from "../bestiary/state";

const participant = (id: number, groupId: number, sheetId: number, name: string, source: [number, string] | null, sourceLabel: string | null = null): EncounterParticipant =>
    ({ id, groupId, sheetId, npc: true, displayName: null, name, sourceCreatureId: source?.[0] ?? null, sourceCreatureName: source?.[1] ?? null, sourceLabel });

// An orc copied from the gamemaster's creature, a cultist made with "New NPC"
// and a kroot copied from another user's creature.
const opened: EncounterPayload = {
    encounter: {
        id: 1, roomId: 5, name: "Ambush", round: 1, currentGroupId: null, shown: false, initiativeView: null, version: 1, updatedAt: "",
        groups: [{ id: 10, position: 0, name: null }, { id: 11, position: 1, name: null }, { id: 12, position: 2, name: null }],
        participants: [
            participant(1, 10, 200, "Ork Boy 1", [50, "Ork Boy"]),
            participant(2, 11, 201, "Cultist", null),
            participant(3, 12, 202, "Kroot 1", null, "Xenos · alex"),
        ],
    },
    sheets: [],
};

const creature = (id: number, name: string, tags: string[], collectionId = 7): Creature =>
    ({ id, collectionId, name, kind: "black_crusade", tags, sourceLabel: null, updatedAt: "" });

const collection = (id: number, name: string, own: boolean, isDefault = false): BestiaryCollection =>
    ({ id, name, own, owner: own ? "gm" : "alex", visibility: own ? "private" : "public", default: isDefault, subscribed: !own, publishedAt: null, description: "", tags: [], creatures: 1, updatedAt: "" });

// The gamemaster's collections and two subscriptions. The server lists the
// default one first; here it is second, so "Save to collection" looks for it.
const bestiary: Bestiary = {
    collections: [collection(6, "Daemons", true), collection(7, "Orks", true, true), collection(8, "Xenos", false), collection(9, "DoomBC", false)],
    quota: { used: 2048, limit: 10 * 1024 * 1024 },
    tags: { collections: [], creatures: ["elite"] },
};

/** The requests to the server: path with query, method and body. */
const requests: { url: string; method: string; body: unknown }[] = [];

async function server(url: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? "GET";
    requests.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/encounter/1") return json(opened);
    if (url === "/bestiary/collections") return json(bestiary);
    if (url.startsWith("/bestiary/creatures")) {
        const tag = new URL(url, "http://localhost").searchParams.get("tag");
        const all = [creature(50, "Ork Boy", []), creature(51, "Ork Nob", ["elite"]), creature(80, "Kroot", [], 8)];
        return json(tag ? all.filter(c => c.tags.includes(tag)) : all);
    }
    if (url === "/bestiary/add-variant") return json(creature(52, (JSON.parse(String(init.body)) as { name: string }).name, []), 201);
    return new Response("Not Found", { status: 404 });
}

let sent: { type: string; [key: string]: unknown }[] = [];
const onSend = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));

const box = document.createElement("div");
const $ = (selector: string) => box.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...box.querySelectorAll<HTMLElement>(selector)];

function click(el: HTMLElement | null | undefined): void {
    if (!el) throw new Error("Nothing to click");
    act(() => el.click());
}

function change(el: HTMLElement | null, value: string, type = "change"): void {
    act(() => {
        (el as HTMLInputElement).value = value;
        el!.dispatchEvent(new Event(type, { bubbles: true }));
    });
}

const menuOf = (participantId: number) => {
    click($(`[data-participant-id="${participantId}"] .encounter-npc-menu-btn`));
    return $$(`[data-participant-id="${participantId}"] .encounter-npc-menu button`).map(b => b.textContent);
};

function Window() {
    return (
        <>
            <ParticipantColumn npc />
            {fromBestiaryOpen.value && <FromBestiary />}
            <SaveToCollection />
            <AddVariant />
        </>
    );
}

beforeAll(async () => {
    document.body.appendChild(box);
    vi.stubGlobal("fetch", vi.fn(server));
    document.addEventListener("room:sendMessage", onSend);
    initRoomState({
        roomId: 5, csrfToken: "token", inviteLink: "", players: [], chat: { messages: [], hasMore: false }, commands: [], dicePresets: [],
        sheetKinds: [{ kind: "black_crusade", label: "Black Crusade" }],
    } as unknown as RoomPayload);
    initEncounter({ encounters: { encounters: [{ id: 1, name: "Ambush", updatedAt: "" }], shownEncounterId: null }, initiativeView: null } as unknown as RoomPayload);
    await vi.waitFor(() => expect(encounter.value?.id).toBe(1));
    act(() => render(<Window />, box));
});

afterAll(() => {
    render(null, box);
    document.removeEventListener("room:sendMessage", onSend);
    vi.unstubAllGlobals();
});

beforeEach(() => {
    sent = [];
    requests.length = 0;
});

describe("From bestiary", () => {
    it("adds copies of the creature picked to the encounter", async () => {
        click($(".encounter-from-bestiary"));
        await vi.waitFor(() => expect($$(".encounter-creature-name").map(e => e.textContent)).toEqual(["Ork Boy", "Ork Nob", "Kroot · alex"]));
        expect($(".encounter-quota")!.textContent).toBe("Used 2 KB of 10 MB");
        expect(($(".encounter-add-creature") as HTMLButtonElement).disabled).toBe(true);

        change($('select[aria-label="Tag"]'), "elite");
        await vi.waitFor(() => expect($$(".encounter-creature-name").map(e => e.textContent)).toEqual(["Ork Nob"]));
        expect(requests.at(-1)!.url).toBe("/bestiary/creatures?tag=elite");

        click($('.encounter-creature[data-creature-id="51"]'));
        change($(".encounter-creature-count"), "3", "input");
        click($(".encounter-add-creature"));

        expect(sent).toEqual([{ type: "encounterAddCreature", encounterId: 1, creatureId: 51, count: 3, eventID: expect.any(String) }]);
        expect($(".encounter-from-bestiary-modal")).toBeNull();
    });

    it("groups the collections as the bestiary page does and adds another user's creature", async () => {
        click($(".encounter-from-bestiary"));
        await vi.waitFor(() => expect($$(".encounter-creature-name").length).toBe(3));
        const groups = $$('select[aria-label="Collection"] optgroup').map(g =>
            [g.getAttribute("label"), ...[...g.querySelectorAll("option")].map(o => o.textContent)]);
        expect(groups).toEqual([["My", "Daemons", "Orks"], ["Subscriptions", "Xenos · alex", "DoomBC · alex"]]);
        // Only another user's creature names its owner.
        expect($$(".encounter-creature-owner").map(e => e.closest<HTMLElement>(".encounter-creature")!.dataset.creatureId)).toEqual(["80"]);
        expect($(".encounter-creature-owner")!.textContent).toBe(" · alex");

        change($('select[aria-label="Collection"]'), "8");
        await vi.waitFor(() => expect(requests.at(-1)!.url).toBe("/bestiary/creatures?collection=8"));
        click($('.encounter-creature[data-creature-id="80"]'));
        click($(".encounter-add-creature"));
        expect(sent).toEqual([{ type: "encounterAddCreature", encounterId: 1, creatureId: 80, count: 1, eventID: expect.any(String) }]);
    });
});

describe("the menu of an NPC", () => {
    it("adds a variant of the creature an NPC was copied from under the name given", async () => {
        expect(menuOf(1)).toContain("Add variant to bestiary…");
        click($$('[data-participant-id="1"] .encounter-npc-menu button').find(b => b.textContent === "Add variant to bestiary…"));
        expect(($(".add-variant-name") as HTMLInputElement).value).toBe("Ork Boy 1");
        change($(".add-variant-name"), " Ork Nob ", "input");
        click($(".add-variant-add"));
        expect($(".add-variant-modal")).toBeNull();
        await vi.waitFor(() => expect(requests.find(r => r.url === "/bestiary/add-variant")?.body).toEqual({ sheetId: 200, name: "Ork Nob" }));
        await vi.waitFor(() => expect(toasts.value.at(-1)?.message).toBe('"Ork Nob" added to Orks'));
    });

    it("has no variant for an NPC that is no copy of a creature", () => {
        expect(menuOf(2)).not.toContain("Add variant to bestiary…");
        click($('[data-participant-id="2"] .encounter-npc-menu-btn'));
    });

    it("has no variant for a copy of another user's creature", () => {
        expect(menuOf(3)).not.toContain("Add variant to bestiary…");
        click($('[data-participant-id="3"] .encounter-npc-menu-btn'));
    });

    it("has no update in the bestiary any more", () => {
        for (const id of [1, 2, 3]) {
            expect(menuOf(id)).not.toContain("Update in bestiary");
            click($(`[data-participant-id="${id}"] .encounter-npc-menu-btn`));
        }
    });

    it("saves an NPC to a collection of the gamemaster's only", async () => {
        expect(menuOf(2)).toContain("Save to collection");
        click($$('[data-participant-id="2"] .encounter-npc-menu button').find(b => b.textContent === "Save to collection"));
        expect(savingSheet.value).toEqual({ sheetId: 201, name: "Cultist" });
        await vi.waitFor(() => expect($$(".save-to-collection-target option").map(o => o.textContent)).toEqual(["Daemons", "Orks", "New collection…"]));
        // The default collection is picked at first.
        expect(($(".save-to-collection-target") as HTMLSelectElement).value).toBe("7");
    });
});
