import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import type { SheetPayload } from "../sheet/payload";
import type { BestiaryCollection, CatalogRow, Creature } from "./types.gen";
import { initBestiary } from "./actions";
import { Bestiary } from "./components/Bestiary";
import { toasts } from "./state";

const collection = (id: number, name: string, own: boolean, visibility: BestiaryCollection["visibility"], isDefault = false): BestiaryCollection =>
    ({ id, name, own, owner: own ? "gm" : "alex", visibility, default: isDefault, subscribed: false, publishedAt: null, description: "", tags: [], creatures: 1, updatedAt: "" });

const creature = (id: number, collectionId: number, name: string, sourceLabel: string | null = null): Creature =>
    ({ id, collectionId, name, kind: "black_crusade", tags: [], sourceLabel, updatedAt: "" });

// Every collection the server knows: the user's two, public ones of alex and a private one of alex.
let all = [
    collection(1, "Orks", true, "private", true),
    collection(3, "Cult", true, "public"),
    collection(5, "Xenos", false, "public"),
    collection(6, "DoomBC", false, "public"),
    collection(7, "Slaanesh", false, "public"),
    collection(8, "Ghouls", false, "public"),
    collection(9, "Secrets", false, "private"),
];
/** The user's subscriptions, the last made first. */
let subscriptions = [5, 6];

const visible = (c: BestiaryCollection) => c.own || c.visibility === "public";
const find = (id: number) => all.find(c => c.id === id && visible(c));
const withSubscription = (c: BestiaryCollection): BestiaryCollection => ({ ...c, subscribed: subscriptions.includes(c.id) });
const listed = () => [
    ...all.filter(c => c.own),
    ...subscriptions.map(find).filter(c => c !== undefined).map(withSubscription),
];

const creaturesOf: Record<string, Creature[]> = {
    1: [creature(11, 1, "Ork Boy", "Xenos · alex")],
    3: [],
    5: [creature(51, 5, "Kroot")],
    6: [creature(61, 6, "Gaunt")],
    7: [creature(71, 7, "Daemonette")],
    8: [creature(81, 8, "Ghoul")],
};

const catalogRow = (id: number, name: string, own = false): CatalogRow =>
    ({ id, name, owner: own ? "gm" : "alex", own, creatures: 1, tags: ["chaos"], publishedAt: "2026-10-01T00:00:00Z" });

// 60 public collections: the first page has 50.
const catalog = [
    catalogRow(3, "Cult", true), catalogRow(7, "Slaanesh"), catalogRow(6, "DoomBC"), catalogRow(8, "Ghouls"),
    ...Array.from({ length: 56 }, (_, i) => catalogRow(100 + i, `Horde ${i}`)),
];

const sheet = (sheetId: string): SheetPayload => ({
    sheetId,
    kind: "black_crusade",
    canEdit: false,
    content: { characterInfo: { characterName: "Ghoul" } } as unknown as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
});

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const notFound = () => new Response("Not Found", { status: 404 });

/** The changes the page sent, and the catalog pages it read. */
const sent: { method: string; path: string; body: unknown }[] = [];
const catalogReads: string[] = [];

async function server(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input, "http://localhost");
    const method = init.method ?? "GET";
    if (url.pathname === "/sheet.css") return new Response("");
    if (method !== "GET") sent.push({ method, path: url.pathname, body: JSON.parse(String(init.body ?? "null")) });
    if (url.pathname === "/bestiary/collections") {
        return json({ collections: listed(), quota: { used: 0, limit: 10 << 20 }, tags: { collections: ["chaos"], creatures: [] } });
    }
    if (url.pathname === "/bestiary/creatures") {
        const id = Number(url.searchParams.get("collection"));
        return find(id) ? json(creaturesOf[id] ?? []) : notFound();
    }
    if (url.pathname === "/bestiary/catalog") {
        catalogReads.push(url.search);
        const q = url.searchParams.get("q") ?? "";
        // The fake cursor is the index of the next row.
        const start = Number(url.searchParams.get("after")?.slice(1) ?? 0);
        let rows = catalog.filter(c => c.name.toLowerCase().includes(q.toLowerCase()));
        if (url.searchParams.get("sort") === "old") rows = rows.toReversed();
        return json({ rows: rows.slice(start, start + 50), next: rows.length > start + 50 ? `c${start + 50}` : null });
    }
    if (url.pathname.match(/^\/sheet\/view\/\d+$/)) return json(sheet(url.pathname.split("/").at(-1)!));
    const one = url.pathname.match(/^\/bestiary\/collections\/(\d+)$/);
    if (one && method === "GET") {
        const c = find(Number(one[1]));
        return c ? json(withSubscription(c)) : notFound();
    }
    if (one && method === "PATCH") {
        const id = Number(one[1]);
        all = all.map(c => c.id === id ? { ...c, ...sent.at(-1)!.body as Partial<BestiaryCollection> } : c);
        return json(find(id));
    }
    const subscription = url.pathname.match(/^\/bestiary\/subscriptions\/(\d+)$/);
    if (subscription) {
        const id = Number(subscription[1]);
        subscriptions = subscriptions.filter(s => s !== id);
        if (method === "DELETE") return new Response(null, { status: 204 });
        subscriptions = [id, ...subscriptions];
        return json(withSubscription(find(id)!));
    }
    const copy = url.pathname.match(/^\/bestiary\/creatures\/(\d+)\/copy$/);
    if (copy) return json(creature(99, (sent.at(-1)!.body as { collectionId?: number }).collectionId ?? 9, "Ghoul", "Ghouls · alex"), 201);
    return notFound();
}

const box = document.createElement("div");
const $ = (selector: string) => box.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...box.querySelectorAll<HTMLElement>(selector)];
const section = (name: string) => $$(`[data-section="${name}"] .bestiary-collection-name`).map(e => e.textContent);
const title = () => $(".bestiary-collection-view .bestiary-title")?.textContent;
const creatureNames = () => $$(".bestiary-creature-name").map(e => e.textContent);
const catalogNames = () => $$(".bestiary-catalog-name").map(e => e.firstChild!.textContent);
const catalogButton = (id: number) => $(`.bestiary-catalog-table tr[data-collection-id="${id}"] .bestiary-catalog-subscribe`);

function click(el: HTMLElement | null | undefined): void {
    if (!el) throw new Error("Nothing to click");
    act(() => el.click());
}

function type(el: HTMLElement | null, value: string): void {
    act(() => {
        (el as HTMLInputElement).value = value;
        el!.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function choose(el: HTMLElement | null, value: string): void {
    act(() => {
        (el as HTMLSelectElement).value = value;
        el!.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

const menuItems = (menu: string) => {
    click($(`.${menu} .bestiary-menu-btn`));
    const items = $$(`.${menu} [role="menuitem"]`);
    click($(`.${menu} .bestiary-menu-btn`));
    return items.map(i => i.textContent);
};

const payload = { csrfToken: "token", sheetKinds: [{ kind: "black_crusade" as const, label: "Black Crusade" }] };

beforeAll(async () => {
    box.className = "bestiary";
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
    // An address of alex's public collection, to which the user is not subscribed, brought them here.
    history.replaceState(null, "", "/bestiary?collection=8");
    act(() => render(<Bestiary />, box));
    await act(() => initBestiary(payload, 8));
});

afterAll(() => {
    render(null, box);
    vi.unstubAllGlobals();
});

describe("subscriptions on the bestiary page", () => {
    it("lists the user's collections and their subscriptions", () => {
        expect(section("own")).toEqual(["Orks", "Cult"]);
        expect(section("subscribed")).toEqual(["Xenos · alex", "DoomBC · alex"]);
        expect($('[data-section="own"] .bestiary-default')!.closest<HTMLElement>(".bestiary-collection")!.dataset.collectionId).toBe("1");
        expect($$('[data-section="own"] .bestiary-visibility').map(e => e.textContent)).toEqual(["public"]);
        // Only a subscription leaves the list.
        expect($$('[data-section="own"] .bestiary-unsubscribe')).toEqual([]);
        expect($$(".bestiary-unsubscribe").length).toBe(2);
    });

    it("opens a public collection of the address without a subscription", async () => {
        expect(title()).toBe("Ghouls");
        await vi.waitFor(() => expect(creatureNames()).toEqual(["Ghoul"]));
        expect(location.search).toBe("?collection=8");
        expect($(".bestiary-collection.selected")).toBeNull();
        // Another user's collection is read-only.
        expect($(".bestiary-owner")!.textContent).toBe("by alex");
        expect($(".bestiary-upload")).toBeNull();
        expect($(".bestiary-new-creature")).toBeNull();
        expect($(".bestiary-collection-menu")).toBeNull();
        expect($(".bestiary-subscribe")!.textContent).toBe("Subscribe");
    });

    it("subscribes from the header", async () => {
        click($(".bestiary-subscribe"));
        await vi.waitFor(() => expect(section("subscribed")).toEqual(["Ghouls · alex", "Xenos · alex", "DoomBC · alex"]));
        expect(sent.at(-1)).toEqual({ method: "PUT", path: "/bestiary/subscriptions/8", body: null });
        expect($(".bestiary-subscribe")!.textContent).toBe("Unsubscribe");
        expect($(".bestiary-collection.selected")!.dataset.collectionId).toBe("8");
    });

    it("unsubscribes from the header and keeps the collection open", async () => {
        click($(".bestiary-subscribe"));
        await vi.waitFor(() => expect(section("subscribed")).toEqual(["Xenos · alex", "DoomBC · alex"]));
        expect(sent.at(-1)).toEqual({ method: "DELETE", path: "/bestiary/subscriptions/8", body: null });
        expect(title()).toBe("Ghouls");
        expect(creatureNames()).toEqual(["Ghoul"]);
        expect($(".bestiary-subscribe")!.textContent).toBe("Subscribe");
    });

    it("copies a creature of another user into the default collection unless another is picked", async () => {
        click($('.bestiary-table tr[data-creature-id="81"]'));
        expect($(".bestiary-creature-menu")).toBeNull();
        expect($(".bestiary-export")!.getAttribute("href")).toBe("/sheet/export/81");
        click($(".bestiary-copy-to-mine"));
        // Only the user's collections, and a new one.
        expect($$(".bestiary-dialog-target option").map(o => o.textContent)).toEqual(["Orks", "Cult", "New collection…"]);
        expect(($(".bestiary-dialog-target") as HTMLSelectElement).value).toBe("1");
        choose($(".bestiary-dialog-target"), "3");
        click($(".bestiary-dialog-ok"));
        await vi.waitFor(() => expect($(".bestiary-dialog")).toBeNull());
        expect(sent.at(-1)).toEqual({ method: "POST", path: "/bestiary/creatures/81/copy", body: { collectionId: 3 } });
    });

    it("copies a creature into a new collection in one request", async () => {
        click($(".bestiary-copy-to-mine"));
        choose($(".bestiary-dialog-target"), "0");
        type($(".bestiary-new-collection-name"), "Ghouls");
        const before = sent.length;
        click($(".bestiary-dialog-ok"));
        await vi.waitFor(() => expect($(".bestiary-dialog")).toBeNull());
        // The server makes the collection with the copy: a copy it refuses leaves none.
        expect(sent.slice(before)).toEqual([{ method: "POST", path: "/bestiary/creatures/81/copy", body: { newCollection: "Ghouls" } }]);
    });

    it("keeps the collection picked in the address and forgets the one opened without a subscription", async () => {
        click($('.bestiary-collection[data-collection-id="1"]'));
        expect(location.search).toBe("?collection=1");
        await vi.waitFor(() => expect(creatureNames()).toEqual(["Ork Boy"]));
        click($('.bestiary-table tr[data-creature-id="11"]'));
        expect($(".bestiary-source")!.textContent).toBe("Source: Xenos · alex");
    });

    it("makes a public collection private without asking", async () => {
        click($('.bestiary-collection[data-collection-id="3"]'));
        expect(menuItems("bestiary-collection-menu")).toEqual(["Rename", "Description", "Tags", "Make private", "Export", "Delete"]);
        click($(".bestiary-collection-menu .bestiary-menu-btn"));
        click($$('.bestiary-collection-menu [role="menuitem"]').find(i => i.textContent === "Make private"));
        await vi.waitFor(() => expect($(".bestiary-collection-view .bestiary-visibility")!.textContent).toBe("private"));
        expect(sent.at(-1)).toEqual({ method: "PATCH", path: "/bestiary/collections/3", body: { visibility: "private" } });
        expect($(".confirm-text")).toBeNull();
    });

    it("searches, filters, orders and pages the catalog", async () => {
        click($(".bestiary-catalog-link"));
        await vi.waitFor(() => expect(catalogNames().length).toBe(50));
        expect(catalogReads.at(-1)).toBe("?sort=new");
        expect(catalogNames().slice(0, 4)).toEqual(["Cult", "Slaanesh", "DoomBC", "Ghouls"]);
        expect($$(".bestiary-yours").length).toBe(1);
        // The user's own has no button; a subscription is marked.
        expect(catalogButton(3)).toBeNull();
        expect(catalogButton(6)!.textContent).toBe("Subscribed");
        expect(catalogButton(7)!.textContent).toBe("Subscribe");

        click($(".bestiary-catalog-more"));
        await vi.waitFor(() => expect(catalogNames().length).toBe(60));
        expect(catalogReads.at(-1)).toBe("?sort=new&after=c50");
        expect($(".bestiary-catalog-more")).toBeNull();

        choose($(".bestiary-catalog-sort"), "old");
        await vi.waitFor(() => expect(catalogNames()[0]).toBe("Horde 55"));
        type($(".bestiary-catalog-tag"), "chaos");
        type($(".bestiary-catalog-search"), "slaa");
        await vi.waitFor(() => expect(catalogNames()).toEqual(["Slaanesh"]));
        expect(catalogReads.at(-1)).toBe("?sort=old&q=slaa&tag=chaos");
    });

    it("subscribes from the catalog and stays in it", async () => {
        click(catalogButton(7));
        await vi.waitFor(() => expect(catalogButton(7)!.textContent).toBe("Subscribed"));
        expect(sent.at(-1)).toEqual({ method: "PUT", path: "/bestiary/subscriptions/7", body: null });
        expect(section("subscribed")).toEqual(["Slaanesh · alex", "Xenos · alex", "DoomBC · alex"]);
        expect($(".bestiary-catalog")).not.toBeNull();
    });

    it("opens a collection of the catalog without a subscription", async () => {
        type($(".bestiary-catalog-search"), "ghou");
        await vi.waitFor(() => expect(catalogNames()).toEqual(["Ghouls"]));
        const before = sent.length;
        click($('.bestiary-catalog-table tr[data-collection-id="8"]'));
        await vi.waitFor(() => expect(title()).toBe("Ghouls"));
        expect(sent.length).toBe(before);
        expect(section("subscribed")).toEqual(["Slaanesh · alex", "Xenos · alex", "DoomBC · alex"]);
        expect($(".bestiary-subscribe")!.textContent).toBe("Subscribe");
        await vi.waitFor(() => expect(creatureNames()).toEqual(["Ghoul"]));
    });

    it("unsubscribes with × in the list", async () => {
        click($('.bestiary-unsubscribe[aria-label="Unsubscribe from Xenos"]'));
        await vi.waitFor(() => expect(section("subscribed")).toEqual(["Slaanesh · alex", "DoomBC · alex"]));
        expect(sent.at(-1)).toEqual({ method: "DELETE", path: "/bestiary/subscriptions/5", body: null });
        // The collection shown is another one.
        expect(title()).toBe("Ghouls");
    });

    it("says so and reads the list again when a subscription is no longer public", async () => {
        click($('.bestiary-collection[data-collection-id="6"]'));
        await vi.waitFor(() => expect(creatureNames()).toEqual(["Gaunt"]));
        // The owner made it private.
        all = all.map(c => c.id === 6 ? { ...c, visibility: "private" } : c);
        type($(".bestiary-search"), "g");
        await vi.waitFor(() => expect(toasts.value.map(t => t.message)).toContain("The collection is no longer shared with you."));
        await vi.waitFor(() => expect(section("subscribed")).toEqual(["Slaanesh · alex"]));
        await vi.waitFor(() => expect(title()).toBe("Orks"));
    });

    it("opens the first own collection for an address of another user's private one", async () => {
        await act(() => initBestiary(payload, 9));
        expect(toasts.value.map(t => t.message)).toContain("The collection is not shared.");
        expect(title()).toBe("Orks");
        expect(location.search).toBe("?collection=1");
    });
});
