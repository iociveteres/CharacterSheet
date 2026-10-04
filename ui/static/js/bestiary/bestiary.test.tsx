import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { SheetPayload } from "../sheet/payload";
import type { Bestiary as BestiaryData, BestiaryCollection, Creature } from "./types.gen";
import type { SheetKind } from "../sheet/kinds/kinds.gen";
import { initBestiary } from "./actions";
import { Bestiary } from "./components/Bestiary";
import { sheets } from "../sheet/instance";

const creature = (id: number, collectionId: number, name: string): Creature =>
    ({ id, collectionId, name, kind: "black_crusade", sourceLabel: null, author: "gm", byYou: true, updatedAt: "" });

const bestiary: BestiaryData = {
    collections: [
        { id: 1, name: "Orks", own: true, owner: "gm", visibility: "private", default: true, subscribed: false, publishedAt: null, description: "Green and mean", creatures: 2, updatedAt: "" },
        { id: 2, name: "Daemons", own: true, owner: "gm", visibility: "private", default: false, subscribed: false, publishedAt: null, description: "", creatures: 1, updatedAt: "" },
    ],
    quota: { used: 180 * 1024, limit: 10 * 1024 * 1024 },
};

const creaturesOf: Record<string, Creature[]> = {
    1: [creature(11, 1, "Ork Boy"), creature(12, 1, "Gretchin")],
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
    if (method === "GET" && patch) return json(bestiary.collections.find(c => c.id === Number(patch[1])));
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
    const renamed = url.pathname.match(/^\/bestiary\/creatures\/(\d+)$/);
    if (method === "PATCH" && renamed) {
        const { name } = sent.at(-1)!.body as { name: string };
        creaturesOf[1] = creaturesOf[1].map(c => c.id === Number(renamed[1]) ? { ...c, name } : c);
        return json(creaturesOf[1].find(c => c.id === Number(renamed[1])));
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

/** The ⋯ menu in the row of creature `id`. */
const menu = (id: number) => `tr[data-creature-id="${id}"] .bestiary-creature-menu`;

const menuItem = (id: number, label: string) => {
    click($(`${menu(id)} .bestiary-menu-btn`));
    return $$(`${menu(id)} [role="menuitem"]`).find(b => b.textContent === label);
};

const menuItems = (id: number) => {
    click($(`${menu(id)} .bestiary-menu-btn`));
    const items = $$(`${menu(id)} [role="menuitem"]`).map(i => i.textContent);
    click($(`${menu(id)} .bestiary-menu-btn`));
    return items;
};

/** The buttons of the collection shown, in the row of its header. */
const actions = () => $$(".bestiary-collection-actions .bestiary-action").map(a => a.textContent);
const action = (label: string) => $$(".bestiary-collection-actions .bestiary-action").find(a => a.textContent === label);

function blur(el: HTMLElement | null): void {
    act(() => {
        el!.dispatchEvent(new FocusEvent("blur"));
    });
}

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
        // The description is under the header; the right panel waits for a creature.
        expect($(".bestiary-collection-view .bestiary-description")!.textContent).toBe("Green and mean");
        expect($(".bestiary-creature .bestiary-description")).toBeNull();
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
        expect(block()!.querySelector(".rollable")).not.toBeNull();
        const fields = [...block()!.querySelectorAll<HTMLInputElement>("input, textarea, select")];
        expect(fields.filter(f => !f.readOnly && !f.disabled).length).toBeGreaterThan(0);
    });

    it("keeps the stat block shown until the sheet of the next creature picked is read", async () => {
        click($('.bestiary-table tr[data-creature-id="12"]'));
        expect($("tr.selected")!.dataset.creatureId).toBe("12");
        expect($(".bestiary-creature-view")!.dataset.creatureId).toBe("11");
        expect(block()).not.toBeNull();
        await vi.waitFor(() => expect($("#statblock-sheet")?.dataset.sheetId).toBe("12"));
        expect($(".bestiary-creature-view .bestiary-title")!.textContent).toBe("Gretchin");
        expect(block()).not.toBeNull();
        expect(sheets.has("11")).toBe(false);

        click($('.bestiary-table tr[data-creature-id="11"]'));
        await vi.waitFor(() => expect($("#statblock-sheet")?.dataset.sheetId).toBe("11"));
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

    it("copies, moves, exports and deletes a creature from the menu of its row", () => {
        expect($$(".bestiary-creature-table th").map(th => th.textContent)).toEqual(["Name", "Kind", ""]);
        click($('.bestiary-table tr[data-creature-id="11"]'));
        expect(menuItems(11)).toEqual(["Copy to…", "Move to…", "Export", "Delete"]);
    });

    it("takes a creature moved to another collection out of the list", async () => {
        click($('.bestiary-table tr[data-creature-id="12"]'));
        click(menuItem(12, "Move to…"));
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
        await vi.waitFor(() => expect($(".bestiary-creature-view")?.dataset.creatureId).toBe("13"));
        expect(sent.at(-1)).toEqual({ method: "POST", path: "/bestiary/collections/1/creatures", body: { kind: "pathfinder_crusade" } });
        expect(rows()).toEqual(["Ork Boy", "New creature"]);
        // Picked, not opened.
        await vi.waitFor(() => expect(block()).not.toBeNull());
        expect($(".sheet-popup")).toBeNull();
    });

    it("opens the creature of the address, as the room's \"Edit in bestiary\" links to it", async () => {
        click($('.bestiary-collection[data-collection-id="2"]'));
        await act(() => initBestiary({ csrfToken: "token", sheetKinds: kinds }, 1, 11));
        expect($(".bestiary-collection-view")!.dataset.collectionId).toBe("1");
        expect($(".bestiary-creature-view")!.dataset.creatureId).toBe("11");
        await vi.waitFor(() => expect($(".sheet-popup")).not.toBeNull());
        click($(".sheet-popup-close"));
    });

    it("leaves the full sheet closed on a click in the stat block", async () => {
        click($('.bestiary-table tr[data-creature-id="11"]'));
        await vi.waitFor(() => expect(block()).not.toBeNull());
        click($(".bestiary-statblock"));
        expect($(".sheet-popup")).toBeNull();
        click($(".bestiary-open-sheet"));
        expect($(".sheet-popup")).not.toBeNull();
        click($(".sheet-popup-close"));
    });

    it("renames no creature in its row: that is done in its sheet", () => {
        expect($('tr[data-creature-id="11"] .bestiary-rename')).toBeNull();
    });

    it("keeps the default collection private and undeleted", () => {
        expect(actions()).toEqual(["Export"]);
    });

    it("renames the collection in place, and Esc leaves the name", async () => {
        click($(".bestiary-rename"));
        type($(".bestiary-name-input"), "Greenskins");
        press($(".bestiary-name-input"), "Escape");
        expect($(".bestiary-name-input")).toBeNull();
        expect(sent.some(s => s.method === "PATCH" && (s.body as { name?: string }).name === "Greenskins")).toBe(false);
        click($(".bestiary-rename"));
        type($(".bestiary-name-input"), "Greenskins");
        blur($(".bestiary-name-input"));
        await vi.waitFor(() => expect($(".bestiary-collection-view .bestiary-title")!.textContent).toBe("Greenskins"));
        expect(sent.at(-1)).toEqual({ method: "PATCH", path: "/bestiary/collections/1", body: { name: "Greenskins" } });
    });

    it("edits the description in place and saves it when the user leaves it", async () => {
        click($(".bestiary-description-row .bestiary-rename"));
        const field = $(".bestiary-description-field") as HTMLTextAreaElement;
        expect(field.value).toBe("Green and mean");
        type(field, "Green and meaner");
        blur(field);
        await vi.waitFor(() => expect(sent.at(-1)).toEqual({ method: "PATCH", path: "/bestiary/collections/1", body: { description: "Green and meaner" } }));
        expect($(".bestiary-description-field")).toBeNull();

        // Unchanged, it is not sent again; Esc keeps the old one.
        const count = sent.length;
        click($(".bestiary-description-row .bestiary-rename"));
        blur($(".bestiary-description-field"));
        click($(".bestiary-description-row .bestiary-rename"));
        type($(".bestiary-description-field"), "Red");
        press($(".bestiary-description-field"), "Escape");
        expect($(".bestiary-description-field")).toBeNull();
        expect(sent.length).toBe(count);
    });

    it("opens a description the line cuts in a card over the creatures, closed by a click outside or Esc", async () => {
        // A line that holds it all does not open.
        expect($(".bestiary-description")!.getAttribute("role")).toBeNull();
        click($(".bestiary-description"));
        expect($(".bestiary-description-card")).toBeNull();

        click($(".bestiary-description-row .bestiary-rename"));
        expect($(".bestiary-description-card .bestiary-description-field")).not.toBeNull();
        type($(".bestiary-description-field"), "Green and meaner\nAnd louder");
        blur($(".bestiary-description-field"));
        await vi.waitFor(() => expect($(".bestiary-description")!.getAttribute("role")).toBe("button"));
        expect($(".bestiary-description-card")).toBeNull();

        click($(".bestiary-description"));
        expect($(".bestiary-description-full")!.textContent).toBe("Green and meaner\nAnd louder");
        expect($(".bestiary-description")!.getAttribute("aria-expanded")).toBe("true");
        click($(".bestiary-collection-view .bestiary-title"));
        expect($(".bestiary-description-card")).toBeNull();
        click($(".bestiary-description"));
        press($(".bestiary-description"), "Escape");
        expect($(".bestiary-description-card")).toBeNull();
    });

    it("offers to add a description where there is none", async () => {
        click($('.bestiary-collection[data-collection-id="2"]'));
        await vi.waitFor(() => expect($(".bestiary-add-description")).not.toBeNull());
        expect($(".bestiary-description")).toBeNull();
        click($(".bestiary-add-description"));
        type($(".bestiary-description-field"), "Of the warp");
        blur($(".bestiary-description-field"));
        await vi.waitFor(() => expect(sent.at(-1)).toEqual({ method: "PATCH", path: "/bestiary/collections/2", body: { description: "Of the warp" } }));
        click($('.bestiary-collection[data-collection-id="1"]'));
    });

    it("makes another collection public after asking", async () => {
        click($('.bestiary-collection[data-collection-id="2"]'));
        expect(actions()).toEqual(["Make public…", "Export", "Delete"]);
        click(action("Make public…"));
        expect($(".confirm-text")!.textContent).toContain("Everyone will see it in the catalog");
        click($(".bestiary-confirm-ok"));
        await vi.waitFor(() => expect($(".bestiary-collection-view .bestiary-visibility")!.textContent).toBe("public"));
        expect(sent.at(-1)).toEqual({ method: "PATCH", path: "/bestiary/collections/2", body: { visibility: "public" } });
        expect(actions()).toContain("Make private");
    });
});
