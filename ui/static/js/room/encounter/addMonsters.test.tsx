import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { RoomPayload } from "../payload.gen";
import type { Bestiary, BestiaryCollection, Creature } from "../../bestiary/types.gen";
import type { SheetPayload } from "../../sheet/payload";
import type { EncounterPayload } from "./messages";
import type { EncounterParticipant } from "./types.gen";
import { encounter, previewed } from "./state";
import { initEncounter } from "./actions";
import { listenEncounter } from "./remote";
import { EncounterWindow } from "./components/EncounterWindow";
import { SaveToCollection } from "../components/SaveToCollection";
import { AddVariant } from "../components/AddVariant";
import { initRoomState, toasts } from "../state";
import { savingSheet } from "../bestiary/state";
import { sheets } from "../../sheet/instance";

const participant = (id: number, groupId: number, sheetId: number, name: string, source: [number, string] | null, sourceLabel: string | null = null): EncounterParticipant =>
    ({ id, groupId, sheetId, npc: true, side: "enemies", displayName: null, name, sourceCreatureId: source?.[0] ?? null, sourceCreatureName: source?.[1] ?? null, sourceLabel });

// An orc copied from the gamemaster's creature, a cultist made with "New NPC"
// and a kroot copied from another user's creature.
const opened: EncounterPayload = {
    notes: "",
    encounter: {
        id: 1, roomId: 5, name: "Ambush", round: 1, currentGroupId: null, shown: false, initiativeView: null, version: 1, updatedAt: "",
        groups: [{ id: 10, position: 0, name: null, room: false }, { id: 11, position: 1, name: null, room: false }, { id: 12, position: 2, name: null, room: false }],
        participants: [
            participant(1, 10, 200, "Ork Boy 1", [50, "Ork Boy"]),
            participant(2, 11, 201, "Cultist", null),
            participant(3, 12, 202, "Kroot 1", null, "Xenos · alex"),
        ],
    },
    sheets: [],
};

const creature = (id: number, name: string, collectionId = 7, author = "gm"): Creature =>
    ({ id, collectionId, name, kind: "black_crusade", sourceLabel: null, author, byYou: author === "gm", updatedAt: "" });

const collection = (id: number, name: string, own: boolean, isDefault = false): BestiaryCollection =>
    ({ id, name, own, owner: own ? "gm" : "alex", visibility: own ? "private" : "public", default: isDefault, subscribed: !own, publishedAt: null, description: "", creatures: 1, updatedAt: "" });

// The gamemaster's collections and two subscriptions. The server lists the
// default one first; here it is second, so "Save to collection" looks for it.
const bestiary: Bestiary = {
    collections: [collection(6, "Daemons", true), collection(7, "Orks", true, true), collection(8, "Xenos", false), collection(9, "DoomBC", false)],
    quota: { used: 2048, limit: 10 * 1024 * 1024 },
};

// Off, the gamemaster has subscribed to nothing.
let subscriptions = true;

// The sheet of a creature, with a characteristic and a trained skill to roll.
const creatureSheet = (sheetId: string, name: string): SheetPayload => ({
    sheetId,
    kind: "black_crusade",
    canEdit: true,
    content: {
        characterInfo: { characterName: name },
        characteristics: { BS: { value: 40 } },
        skillsLeft: { awareness: { plus0: true } },
    } as unknown as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
});

/** The creatures "New creature" made. */
const made: Creature[] = [];

/** The requests to the server: path with query, method and body. */
const requests: { url: string; method: string; body: unknown }[] = [];

async function server(url: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? "GET";
    requests.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/sheet.css") return new Response(".stat-block {}");
    if (url === "/encounter/1") return json(opened);
    if (url === "/bestiary/collections") return json(subscriptions ? bestiary : { ...bestiary, collections: bestiary.collections.filter(c => c.own) });
    if (url.startsWith("/bestiary/creatures")) {
        return json([creature(50, "Ork Boy"), creature(51, "Ork Nob"), creature(80, "Kroot", 8, "alex"), ...made]);
    }
    if (method === "POST" && url === "/bestiary/collections/6/creatures") {
        made.push(creature(53, "New creature", 6));
        return json(made.at(-1), 201);
    }
    if (url === "/sheet/view/53" && made.length) return json(creatureSheet("53", made[0].name));
    if (url === "/sheet/view/51") return json(creatureSheet("51", "Ork Nob"));
    if (url === "/sheet/view/80") return json(creatureSheet("80", "Kroot"));
    if (url === "/bestiary/add-variant") return json(creature(52, (JSON.parse(String(init.body)) as { name: string }).name), 201);
    return new Response("Not Found", { status: 404 });
}

let sent: { type: string; [key: string]: unknown }[] = [];
const onSend = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));

const box = document.createElement("div");
const $ = (selector: string) => box.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...box.querySelectorAll<HTMLElement>(selector)];
const texts = (selector: string) => $$(selector).map(e => e.textContent);
const block = () => $("#statblock-sheet")?.shadowRoot?.querySelector<HTMLElement>(".stat-block") ?? null;

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

/** The tab hidden for `ms` and shown again. */
function away(ms: number): void {
    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event("visibilitychange"));
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + ms);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    now.mockRestore();
}

const tab = (name: "combat" | "monsters") => click($(`.encounter-tab[data-tab="${name}"]`));

/** Opens "Add monsters" and waits for the creatures of the collection picked. */
async function openMonsters(): Promise<void> {
    tab("monsters");
    await vi.waitFor(() => expect(texts(".encounter-creature-name")).toEqual(["Ork Boy", "Ork Nob", "Kroot"]));
}

function Window() {
    return (
        <>
            <EncounterWindow />
            <SaveToCollection />
            <AddVariant />
        </>
    );
}

beforeAll(async () => {
    // The sheet's styles come from the container's data-sheet-css (sheet/view.ts).
    document.body.innerHTML = `<div id="character-sheet-container" data-sheet-css="/sheet.css"></div>`;
    document.body.appendChild(box);
    vi.stubGlobal("fetch", vi.fn(server));
    // happy-dom's replace() resolves to undefined; browsers resolve to the sheet.
    vi.stubGlobal("CSSStyleSheet", class extends CSSStyleSheet {
        async replace(text: string): Promise<CSSStyleSheet> {
            await super.replace(text);
            return this;
        }
    });
    document.addEventListener("room:sendMessage", onSend);
    listenEncounter();
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

describe("Add monsters", () => {
    it("takes the place of the turn order and the party, the gamemaster's collections first", async () => {
        expect($('.encounter-tab[aria-selected="true"]')!.dataset.tab).toBe("combat");
        expect($(".encounter-from-bestiary")).toBeNull();
        await openMonsters();
        expect($(".encounter-picker")).toBeNull();
        expect($('[data-column="party"]')).toBeNull();
        expect($('[data-column="enemies"]')).not.toBeNull();
        expect(texts(".encounter-collection")).toEqual(["All collections", "Daemons", "Orks", "Xenos · alex", "DoomBC · alex"]);
        expect(texts('[data-column="collections"] .encounter-column-title')).toEqual(["My collections", "Subscriptions"]);
        // The first of their own collections is picked at first.
        expect($(".encounter-collection.selected")!.dataset.collectionId).toBe("6");
        expect(requests.filter(r => r.url.startsWith("/bestiary/creatures")).map(r => r.url)).toEqual(["/bestiary/creatures?collection=6"]);
        expect($(".encounter-quota")!.textContent).toBe("Used 2 KB of 10 MB");
        // Each creature names its author, the user as you.
        expect(texts(".encounter-creature-author")).toEqual(["by you", "by you", "by alex"]);

        click($('.encounter-collection[data-collection-id="all"]'));
        await vi.waitFor(() => expect(requests.at(-1)!.url).toBe("/bestiary/creatures"));
        click($('.encounter-collection[data-collection-id="8"]'));
        await vi.waitFor(() => expect(requests.at(-1)!.url).toBe("/bestiary/creatures?collection=8"));
        tab("combat");
    });

    it("makes a creature in an own collection only, and previews it with a link to edit it in the bestiary", async () => {
        await openMonsters();
        expect($(".encounter-new-creature-btn")).not.toBeNull();
        click($('.encounter-collection[data-collection-id="8"]'));
        expect($(".encounter-new-creature-btn")).toBeNull();
        click($('.encounter-collection[data-collection-id="all"]'));
        expect($(".encounter-new-creature-btn")).toBeNull();

        click($('.encounter-collection[data-collection-id="6"]'));
        click($(".encounter-new-creature-btn"));
        await vi.waitFor(() => expect($(".statblock-preview")?.dataset.creatureId).toBe("53"));
        expect(requests.find(r => r.method === "POST")).toEqual({ url: "/bestiary/collections/6/creatures", method: "POST", body: { kind: "black_crusade" } });
        expect(texts(".encounter-creature-name")).toContain("New creature");
        expect($(".statblock-edit-creature")!.getAttribute("href")).toBe("/bestiary?collection=6&creature=53");
        expect(sent).toEqual([]);

        // Another user's creature is not edited.
        click($('.encounter-creature[data-creature-id="80"]'));
        await vi.waitFor(() => expect($(".statblock-preview")?.dataset.creatureId).toBe("80"));
        expect($(".statblock-edit-creature")).toBeNull();
        made.length = 0;
        tab("combat");
    });

    it("reads the creatures and the preview again when the gamemaster comes back after a while", async () => {
        await openMonsters();
        click($(".encounter-new-creature-btn"));
        await vi.waitFor(() => expect($("#statblock-sheet")?.dataset.sheetId).toBe("53"));
        const blank = sheets.get("53");

        // Filled in on the bestiary page meanwhile.
        made[0] = { ...made[0], name: "Warboss" };
        away(4000);
        expect(requests.filter(r => r.url === "/sheet/view/53")).toHaveLength(1);
        away(6000);
        await vi.waitFor(() => expect($(".statblock-preview .statblock-name")!.textContent).toBe("Warboss"));
        expect(texts(".encounter-creature-name")).toContain("Warboss");
        await vi.waitFor(() => expect(sheets.get("53")).not.toBe(blank));

        // Deleted meanwhile, it leaves the preview.
        made.length = 0;
        away(6000);
        await vi.waitFor(() => expect($(".statblock-preview")).toBeNull());
        expect(sheets.has("53")).toBe(false);
        tab("combat");
    });

    it("previews the creature clicked, read only and without rolls", async () => {
        await openMonsters();
        click($('.encounter-creature[data-creature-id="51"]'));
        expect($(".encounter-creature.selected")!.dataset.creatureId).toBe("51");
        await vi.waitFor(() => expect(block()).not.toBeNull());
        expect($(".statblock-preview .statblock-name")!.textContent).toBe("Ork Nob");
        expect($(".statblock-collection")!.textContent).toBe("Orks");
        expect(block()!.querySelector('[data-id="BS"] label')).not.toBeNull();
        expect(block()!.querySelector('[data-id="awareness"] [data-id="difficulty"]')).not.toBeNull();
        expect(block()!.querySelector(".rollable")).toBeNull();
        expect(block()!.querySelector("input:not([readonly])")).toBeNull();

        // Another creature's sheet takes the place of the first once it is read: the column does not go empty in between.
        click($('.encounter-creature[data-creature-id="80"]'));
        expect($(".encounter-creature.selected")!.dataset.creatureId).toBe("80");
        expect($(".statblock-preview")!.dataset.creatureId).toBe("51");
        expect(block()).not.toBeNull();
        await vi.waitFor(() => expect($("#statblock-sheet")?.dataset.sheetId).toBe("80"));
        expect($(".statblock-collection")!.textContent).toBe("Xenos · alex");
        expect(block()).not.toBeNull();
        expect(sheets.has("51")).toBe(false);
    });

    it("adds a copy of a creature to the Enemies with the button of its row, without a preview, or with a double click", () => {
        expect($(".statblock-preview .encounter-add-creature")).toBeNull();
        click($('.encounter-creature[data-creature-id="51"] .encounter-add-creature'));
        expect(sent).toEqual([{ type: "encounterAddCreature", encounterId: 1, creatureId: 51, count: 1, eventID: expect.any(String) }]);
        expect(previewed.value?.id).toBe(80);

        act(() => { $('.encounter-creature[data-creature-id="50"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
        expect(sent.at(-1)).toEqual({ type: "encounterAddCreature", encounterId: 1, creatureId: 50, count: 1, eventID: expect.any(String) });
    });

    it("lets the preview go for a card of the Enemies picked", () => {
        expect(sheets.has("80")).toBe(true);
        click($('.encounter-card[data-participant-id="1"] .encounter-card-title'));
        expect(previewed.value).toBeNull();
        expect(sheets.has("80")).toBe(false);
        expect($(".statblock-preview")).toBeNull();
        expect($(".statblock-name")!.textContent).toBe("Ork Boy 1");
    });

    it("lets the preview go on the way back to the combat", async () => {
        click($('.encounter-creature[data-creature-id="51"]'));
        await vi.waitFor(() => expect(sheets.has("51")).toBe(true));
        tab("combat");
        expect(sheets.has("51")).toBe(false);
        expect($(".statblock-preview")).toBeNull();
        expect($(".encounter-picker")).not.toBeNull();
        expect($('[data-column="party"]')).not.toBeNull();
    });

    it("sends the gamemaster without subscriptions to the bestiary", async () => {
        subscriptions = false;
        try {
            tab("monsters");
            await vi.waitFor(() => expect($(".encounter-no-subscriptions a")?.getAttribute("href")).toBe("/bestiary"));
            expect(texts(".encounter-collection")).toEqual(["All collections", "Daemons", "Orks"]);
        } finally {
            subscriptions = true;
            tab("combat");
        }
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

    it("saves an NPC to a collection of the gamemaster's only, from the header of its stat block", async () => {
        expect(menuOf(2)).not.toContain("Save to collection");
        click($('[data-participant-id="2"] .encounter-npc-menu-btn'));
        click($('.encounter-card[data-participant-id="2"] .encounter-card-names'));
        click($('.statblock-picked[data-participant-id="2"] .encounter-save-to-collection'));
        expect(savingSheet.value).toEqual({ sheetId: 201, name: "Cultist" });
        await vi.waitFor(() => expect($$(".save-to-collection-target option").map(o => o.textContent)).toEqual(["Daemons", "Orks", "New collection…"]));
        // The default collection is picked at first.
        expect(($(".save-to-collection-target") as HTMLSelectElement).value).toBe("7");
    });
});
