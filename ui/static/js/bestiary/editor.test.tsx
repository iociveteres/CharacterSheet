import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { SheetPayload } from "../sheet/payload";
import type { BestiaryCollection, Creature } from "./types.gen";
import { addRoll, initBestiary, selectCollection } from "./actions";
import { listenRemote } from "./remote";
import { listenRolls } from "./rolls";
import { Bestiary } from "./components/Bestiary";
import { rolls } from "./state";

const collection = (id: number, name: string, own: boolean): BestiaryCollection =>
    ({ id, name, own, owner: own ? "gm" : "alex", visibility: own ? "private" : "public", default: own, subscribed: !own, publishedAt: null, description: "", creatures: 2, updatedAt: "" });

const creature = (id: number, collectionId: number, name: string): Creature =>
    ({ id, collectionId, name, kind: "black_crusade", sourceLabel: null, author: "gm", byYou: true, updatedAt: "" });

const collections = [collection(1, "Orks", true), collection(6, "DoomBC", false)];
const creaturesOf: Record<string, Creature[]> = {
    1: [creature(11, 1, "Ork Boy"), creature(12, 1, "Gretchin")],
    6: [creature(61, 6, "Gaunt")],
};

// The server lets the owner edit their own creature only (/sheet/view/:id).
const sheet = (id: number): SheetPayload => ({
    sheetId: String(id),
    kind: "black_crusade",
    canEdit: id < 60,
    content: {
        characterInfo: { characterName: Object.values(creaturesOf).flat().find(c => c.id === id)!.name },
        characteristics: { BS: { value: 40 } },
    } as unknown as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
});

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

async function server(input: string): Promise<Response> {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/sheet.css") return new Response("");
    if (url.pathname === "/bestiary/collections") return json({ collections, quota: { used: 0, limit: 10 << 20 } });
    if (url.pathname === "/bestiary/creatures") return json(creaturesOf[url.searchParams.get("collection")!] ?? []);
    const view = url.pathname.match(/^\/sheet\/view\/(\d+)$/);
    if (view) return json(sheet(Number(view[1])));
    return new Response("Not Found", { status: 404 });
}

/** What the page sent over its socket. */
const sent: { type: string; sheetID?: string; path?: string; change?: unknown }[] = [];
const onSend = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));

const box = document.createElement("div");
const $ = (selector: string) => box.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...box.querySelectorAll<HTMLElement>(selector)];
const rows = () => $$(".bestiary-table tbody tr").map(r => r.querySelector(".bestiary-creature-name")!.textContent);
const title = () => $(".bestiary-creature-view .bestiary-title")?.textContent;
const statBlock = () => $("#statblock-sheet")?.shadowRoot?.querySelector<HTMLElement>(".stat-block") ?? null;
const popup = () => $("#popup-sheet")?.shadowRoot ?? null;
const server$ = (type: string, detail: object) => act(() => {
    document.dispatchEvent(new CustomEvent(`ws:${type}`, { detail: { type, ...detail } }));
});

function click(el: Element | null | undefined): void {
    if (!el) throw new Error("Nothing to click");
    act(() => (el as HTMLElement).click());
}

async function pick(id: number): Promise<void> {
    click($(`.bestiary-table tr[data-creature-id="${id}"]`));
    await vi.waitFor(() => expect(statBlock()).not.toBeNull());
}

async function openSheet(): Promise<ShadowRoot> {
    click($(".bestiary-open-sheet"));
    await vi.waitFor(() => expect(popup()?.querySelector('[data-id="characterName"]')).toBeTruthy());
    return popup()!;
}

beforeAll(async () => {
    box.className = "bestiary";
    box.dataset.sheetCss = "/sheet.css";
    document.body.appendChild(box);
    vi.stubGlobal("fetch", vi.fn(server));
    vi.stubGlobal("CSSStyleSheet", class extends CSSStyleSheet {
        async replace(text: string): Promise<CSSStyleSheet> {
            await super.replace(text);
            return this;
        }
    });
    document.addEventListener("room:sendMessage", onSend);
    listenRemote();
    listenRolls();
    act(() => render(<Bestiary />, box));
    await act(() => initBestiary({ csrfToken: "token", sheetKinds: [{ kind: "black_crusade", label: "Black Crusade" }] }));
    await vi.waitFor(() => expect(rows()).toEqual(["Ork Boy", "Gretchin"]));
});

afterEach(() => {
    sent.length = 0;
});

afterAll(() => {
    document.removeEventListener("room:sendMessage", onSend);
    render(null, box);
    vi.unstubAllGlobals();
});

describe("an own creature", () => {
    it("is edited in its stat block and its full sheet, over the page's socket", async () => {
        await pick(11);
        expect($(".bestiary-open-sheet")!.textContent).toBe("Edit");
        // A click on a roll in the stat block rolls and opens nothing.
        click(statBlock()!.querySelector('[data-id="BS"].rollable'));
        expect(popup()).toBeNull();
        expect(sent.map(m => m.type)).toEqual(["roll"]);

        const sheet = await openSheet();
        const name = sheet.querySelector<HTMLInputElement>('[data-id="characterName"]')!;
        expect(name.readOnly).toBe(false);
        act(() => {
            name.value = "Big Ork";
            name.dispatchEvent(new Event("input", { bubbles: true }));
        });
        // The list and the header follow the name as it is typed.
        expect(rows()).toEqual(["Big Ork", "Gretchin"]);
        expect(title()).toBe("Big Ork");
        await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({
            type: "change", sheetID: "11", path: "characterInfo.characterName", change: "Big Ork",
        })));

        press("Escape");
        expect(popup()).toBeNull();
    });

    it("leaves its full sheet closed on a click on the stat block's text", () => {
        click(statBlock()!.querySelector(".stat-armour"));
        expect(popup()).toBeNull();
    });

    it("takes the name another tab gives it", () => {
        server$("change", { eventID: "", sheetID: "12", path: "characterInfo.characterName", change: "Grot" });
        expect(rows()).toEqual(["Big Ork", "Grot"]);
        server$("change", { eventID: "", sheetID: "11", path: "characterInfo.characterName", change: "Warboss" });
        expect(title()).toBe("Warboss");
        expect(statBlock()).not.toBeNull();
    });

    it("goes when another tab deletes it, with its full sheet", async () => {
        await openSheet();
        server$("creaturesDeleted", { ids: [11] });
        expect(popup()).toBeNull();
        expect($(".bestiary-creature-view")).toBeNull();
        expect(rows()).toEqual(["Grot"]);
    });
});

describe("another user's creature", () => {
    it("is only read in its full sheet, and still copied out", async () => {
        await act(() => selectCollection(6));
        await vi.waitFor(() => expect(rows()).toEqual(["Gaunt"]));
        await pick(61);
        expect($(".bestiary-open-sheet")!.textContent).toBe("View");

        const sheet = await openSheet();
        expect(sheet.querySelector<HTMLInputElement>('[data-id="characterName"]')!.readOnly).toBe(true);
        // It rolls all the same.
        click(statBlock()!.querySelector('[data-id="BS"].rollable'));
        expect(sent.map(m => m.type)).toEqual(["roll"]);
        press("Escape");
    });
});

describe("the roll feed", () => {
    it("shows the rolls as chat messages under the character, and folds", () => {
        expect($(".roll-feed")).toBeNull();
        act(() => addRoll({
            id: 1, userId: 0, userName: "", messageBody: "/r d100 vs 40\n>> Ballistic Skill",
            commandResult: "d100 vs 40:\n12, 2 success", characterName: "Gaunt", createdAt: "2026-10-01T12:00:00Z",
        }));
        expect($(".roll-feed-name")!.textContent).toBe("Gaunt");
        expect($(".roll-feed .message-body")!.textContent).toBe("/r d100 vs 40\n>> Ballistic Skill");
        expect($(".roll-feed .command-result")!.textContent).toBe("d100 vs 40:\n12, 2 success");

        click($(".roll-feed-header"));
        expect($(".roll-feed-list")).toBeNull();
        expect($(".roll-feed")!.classList.contains("collapsed")).toBe(true);
        click($(".roll-feed-header"));
        expect($$(".roll-feed .message")).toHaveLength(1);
        act(() => {
            rolls.value = [];
        });
    });
});

function press(key: string): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
}
