import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { SheetPayload } from "../sheet/payload";
import type { Bestiary as BestiaryData, BestiaryCollection, Creature } from "./types.gen";
import type { SheetKind } from "../sheet/kinds/kinds.gen";
import { initBestiary } from "./actions";
import { Bestiary } from "./components/Bestiary";

const creature = (id: number, collectionId: number, name: string, tags: string[] = []): Creature =>
    ({ id, collectionId, name, kind: "black_crusade", tags, sourceLabel: null, updatedAt: "" });

const bestiary: BestiaryData = {
    collections: [
        { id: 1, name: "Orks", own: true, owner: "gm", visibility: "private", default: true, subscribed: false, publishedAt: null, description: "Green and mean", tags: ["greenskins"], creatures: 2, updatedAt: "" },
        { id: 2, name: "Daemons", own: true, owner: "gm", visibility: "private", default: false, subscribed: false, publishedAt: null, description: "", tags: [], creatures: 1, updatedAt: "" },
    ],
    quota: { used: 180 * 1024, limit: 10 * 1024 * 1024 },
    tags: { collections: ["greenskins", "horde"], creatures: ["elite"] },
};

const creaturesOf: Record<string, Creature[]> = {
    1: [creature(11, 1, "Ork Boy", ["infantry"]), creature(12, 1, "Gretchin")],
    2: [creature(21, 2, "Bloodletter")],
};

// The server says the owner may edit the creature.
const sheet = (sheetId: string, name: string): SheetPayload => ({
    sheetId,
    kind: "black_crusade",
    canEdit: true,
    content: {
        characterInfo: { characterName: name },
        characteristics: { BS: { value: 40 } },
        armour: { woundsMax: 12 },
    } as unknown as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
});

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The changes the page sent: method, path and body. */
const sent: { method: string; path: string; body: unknown }[] = [];

async function server(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input, "http://localhost");
    const method = init.method ?? "GET";
    if (url.pathname === "/sheet.css") return new Response(".stat-block {}");
    // noSurf turns away a change without the page's token.
    if (method !== "GET" && (init.headers as Record<string, string>)["X-CSRF-Token"] !== "token") return new Response("Bad Request", { status: 400 });
    if (method !== "GET") sent.push({ method, path: url.pathname, body: JSON.parse(String(init.body ?? "null")) });
    if (url.pathname === "/bestiary/collections") return json(bestiary);
    if (url.pathname === "/bestiary/creatures") {
        const q = url.searchParams.get("q")?.toLowerCase() ?? "";
        return json((creaturesOf[url.searchParams.get("collection")!] ?? []).filter(c => c.name.toLowerCase().includes(q)));
    }
    const view = url.pathname.match(/^\/sheet\/view\/(\d+)$/);
    if (view) return json(sheet(view[1], "Ork Boy"));
    const patch = url.pathname.match(/^\/bestiary\/collections\/(\d+)$/);
    if (method === "PATCH" && patch) {
        const i = bestiary.collections.findIndex(c => c.id === Number(patch[1]));
        bestiary.collections[i] = { ...bestiary.collections[i], ...sent.at(-1)!.body as Partial<BestiaryCollection> };
        return json(bestiary.collections[i]);
    }
    if (method === "POST" && url.pathname === "/bestiary/collections/1/creatures") {
        const created = { ...creature(13, 1, "New creature"), kind: (sent.at(-1)!.body as { kind: SheetKind }).kind };
        creaturesOf[1] = [...creaturesOf[1], created];
        return json(created, 201);
    }
    const move = url.pathname.match(/^\/bestiary\/creatures\/(\d+)\/move$/);
    if (move) {
        const id = Number(move[1]);
        creaturesOf[1] = creaturesOf[1].filter(c => c.id !== id);
        return json(creature(id, 2, "Gretchin"));
    }
    return new Response("Not Found", { status: 404 });
}

const box = document.createElement("div");
const $ = (selector: string) => box.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...box.querySelectorAll<HTMLElement>(selector)];
const rows = () => $$(".bestiary-table tbody tr").map(r => r.querySelector(".bestiary-creature-name")!.textContent);
const block = () => $("#statblock-sheet")?.shadowRoot?.querySelector<HTMLElement>(".stat-block") ?? null;

function click(el: HTMLElement | null | undefined): void {
    if (!el) throw new Error("Nothing to click");
    act(() => el.click());
}

function type(el: HTMLElement | null, value: string): void {
    const input = el as HTMLInputElement;
    act(() => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function press(el: HTMLElement | null, key: string): void {
    act(() => {
        el!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
}

const menuItem = (menu: string, label: string) => {
    click($(`.${menu} .bestiary-menu-btn`));
    return $$(`.${menu} [role="menuitem"]`).find(b => b.textContent === label);
};

const menuItems = (menu: string) => {
    click($(`.${menu} .bestiary-menu-btn`));
    const items = $$(`.${menu} [role="menuitem"]`).map(i => i.textContent);
    click($(`.${menu} .bestiary-menu-btn`));
    return items;
};

const kinds = [{ kind: "black_crusade" as const, label: "Black Crusade" }, { kind: "pathfinder_crusade" as const, label: "Pathfinder Crusade" }];

beforeAll(async () => {
    box.className = "bestiary";
    // The stat block takes the sheet's styles from data-sheet-css (sheet/view.ts).
    box.dataset.sheetCss = "/sheet.css";
    document.body.appendChild(box);
    vi.stubGlobal("fetch", vi.fn(server));
    // happy-dom's replace() resolves to undefined; browsers resolve to the sheet.
    vi.stubGlobal("CSSStyleSheet", class extends CSSStyleSheet {
        async replace(text: string): Promise<CSSStyleSheet> {
            await super.replace(text);
            return this;
        }
    });
    act(() => render(<Bestiary />, box));
    await act(() => initBestiary({ csrfToken: "token", sheetKinds: kinds }));
});

afterAll(() => {
    render(null, box);
    vi.unstubAllGlobals();
});

describe("the bestiary page", () => {
    it("lists the collections and opens the first", async () => {
        expect($$(".bestiary-collection-name").map(e => e.textContent)).toEqual(["Orks", "Daemons"]);
        expect($$(".bestiary-default").map(e => e.closest<HTMLElement>(".bestiary-collection")!.dataset.collectionId)).toEqual(["1"]);
        expect($(".bestiary-collection.selected")!.dataset.collectionId).toBe("1");
        await vi.waitFor(() => expect(rows()).toEqual(["Ork Boy", "Gretchin"]));
        expect($(".bestiary-collection-view .bestiary-title")!.textContent).toBe("Orks");
        expect($(".bestiary-description")!.textContent).toBe("Green and mean");
        expect($(".bestiary-quota")!.textContent).toBe("Used 180 KB of 10 MB");
        expect($(".bestiary-table .bestiary-chip")!.textContent).toBe("BC");
    });

    it("loads the creatures of the collection picked", async () => {
        click($('.bestiary-collection[data-collection-id="2"]'));
        await vi.waitFor(() => expect(rows()).toEqual(["Bloodletter"]));
        click($('.bestiary-collection[data-collection-id="1"]'));
        await vi.waitFor(() => expect(rows()).toEqual(["Ork Boy", "Gretchin"]));
    });

    it("shows the stat block of the creature picked, which its owner edits", async () => {
        click($('.bestiary-table tr[data-creature-id="11"]'));
        expect($(".bestiary-creature-view .bestiary-title")!.textContent).toBe("Ork Boy");
        await vi.waitFor(() => expect(block()).not.toBeNull());
        expect($("#statblock-sheet")!.dataset.sheetId).toBe("11");
        expect(block()!.querySelector("label.rollable")).not.toBeNull();
        const fields = [...block()!.querySelectorAll<HTMLInputElement>("input, textarea, select")];
        expect(fields.filter(f => !f.readOnly && !f.disabled).length).toBeGreaterThan(0);
    });

    it("searches the creatures by name", async () => {
        type($(".bestiary-search"), "gret");
        await vi.waitFor(() => expect(rows()).toEqual(["Gretchin"]));
        // The creature shown is no longer in the list.
        expect($(".bestiary-creature-view")).toBeNull();
        expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === "/bestiary/creatures?collection=1&q=gret")).toBe(true);
        type($(".bestiary-search"), "");
        await vi.waitFor(() => expect(rows()).toEqual(["Ork Boy", "Gretchin"]));
    });

    it("adds and removes tags of the collection", async () => {
        click(menuItem("bestiary-collection-menu", "Tags"));
        const field = $(".bestiary-tag-field");
        expect($$("#bestiary-tag-suggestions option").map(o => o.getAttribute("value"))).toEqual(["horde"]);
        type(field, "horde");
        press(field, "Enter");
        type(field, "warband,");
        expect($$(".bestiary-tag-input .bestiary-chip").map(c => c.firstChild!.textContent)).toEqual(["greenskins", "horde", "warband"]);
        click($('.bestiary-chip-remove[aria-label="Remove greenskins"]'));
        click($(".bestiary-dialog-ok"));
        await vi.waitFor(() => expect($(".bestiary-dialog")).toBeNull());
        expect(sent.at(-1)).toEqual({ method: "PATCH", path: "/bestiary/collections/1", body: { tags: ["horde", "warband"] } });
        await vi.waitFor(() => expect($$(".bestiary-collection-view > .bestiary-tags .bestiary-chip").map(c => c.textContent)).toEqual(["horde", "warband"]));
    });

    it("takes a creature moved to another collection out of the list", async () => {
        click($('.bestiary-table tr[data-creature-id="12"]'));
        click(menuItem("bestiary-creature-menu", "Move to…"));
        // The creature's own collection is no target.
        expect($$(".bestiary-dialog-target option").map(o => o.textContent)).toEqual(["Daemons"]);
        click($(".bestiary-dialog-ok"));
        await vi.waitFor(() => expect(rows()).toEqual(["Ork Boy"]));
        expect(sent.at(-1)).toEqual({ method: "POST", path: "/bestiary/creatures/12/move", body: { collectionId: 2 } });
        expect($(".bestiary-creature-view")).toBeNull();
    });

    it("makes a creature of the kind picked and opens its sheet", async () => {
        const kind = $(".bestiary-new-creature-kind") as HTMLSelectElement;
        expect([...kind.options].map(o => o.textContent)).toEqual(["Black Crusade", "Pathfinder Crusade"]);
        act(() => {
            kind.value = "pathfinder_crusade";
            kind.dispatchEvent(new Event("change", { bubbles: true }));
        });
        click($(".bestiary-new-creature"));
        await vi.waitFor(() => expect($(".sheet-popup")).not.toBeNull());
        expect(sent.at(-1)).toEqual({ method: "POST", path: "/bestiary/collections/1/creatures", body: { kind: "pathfinder_crusade" } });
        expect(rows()).toEqual(["Ork Boy", "New creature"]);
        expect($(".bestiary-creature-view")!.dataset.creatureId).toBe("13");
        click($(".sheet-popup-close"));
        expect($(".sheet-popup")).toBeNull();
    });

    it("keeps the default collection private and undeleted", () => {
        expect(menuItems("bestiary-collection-menu")).toEqual(["Rename", "Description", "Tags", "Export"]);
    });

    it("makes another collection public after asking", async () => {
        click($('.bestiary-collection[data-collection-id="2"]'));
        expect(menuItems("bestiary-collection-menu")).toEqual(["Rename", "Description", "Tags", "Make public…", "Export", "Delete"]);
        click(menuItem("bestiary-collection-menu", "Make public…"));
        expect($(".confirm-text")!.textContent).toContain("Everyone will see it in the catalog");
        click($(".bestiary-confirm-ok"));
        await vi.waitFor(() => expect($(".bestiary-collection-view .bestiary-visibility")!.textContent).toBe("public"));
        expect(sent.at(-1)).toEqual({ method: "PATCH", path: "/bestiary/collections/2", body: { visibility: "public" } });
        expect(menuItems("bestiary-collection-menu")).toContain("Make private");
    });
});
