// A player: a browser context with a room page, and what the scenarios do
// with the sheet in it.
import { expect } from "vitest";
import { chromium, type Browser, type BrowserContext, type ElementHandle, type Page } from "playwright-core";
import { config } from "./config";
import { installProbes, type Msg, type Query, type Roll } from "./probes";
import { eventually } from "./wait";

/** Console noise of the page that is not the sheet's: the analytics script is blocked by the CSP. */
const IGNORED = [/umami/i];

export const NAV_TABS = {
    player: "show-player-sheet",
    combat: "show-combat",
    talents: "show-talents",
    gear: "show-gear",
    advancements: "show-advancements",
    psykana: "show-psykana",
    techno: "show-techno-arcana",
} as const;

export type NavTab = keyof typeof NAV_TABS;

/** An item's own drag handle or delete button, not those of the grids inside it. */
const OWN_CONTROL = (cls: string) => `:scope > .split-header ${cls}, :scope > ${cls}`;

export async function launch(): Promise<Browser> {
    return chromium.launch({ channel: "chrome", headless: !config.headed });
}

export class Player {
    /** console.error, console.warn and uncaught errors since the last takeErrors. */
    private errors: string[] = [];

    private constructor(readonly name: string, readonly context: BrowserContext, readonly page: Page, readonly base: string) {
        page.on("console", m => {
            if (m.type() !== "error" && m.type() !== "warning") return;
            if (IGNORED.some(re => re.test(m.text()))) return;
            this.errors.push(`${m.type()}: ${m.text()}`);
        });
        page.on("pageerror", e => this.errors.push(`pageerror: ${e.message}`));
    }

    static async create(browser: Browser, name: string, { base = config.base, auth = config.auth } = {}): Promise<Player> {
        const context = await browser.newContext({ storageState: auth, viewport: { width: 1280, height: 1000 } });
        await context.addInitScript(installProbes);
        const page = await context.newPage();
        return new Player(name, context, page, base);
    }

    async close(): Promise<void> {
        await this.context.close();
    }

    takeErrors(): string[] {
        return this.errors.splice(0);
    }

    // ─── Navigation ──────────────────────────────────────────────────────────

    /**
     * Opens the room with the sheet in it, as a link to the sheet does.
     * `socket: false` does not wait for the connection, e.g. for the old build.
     */
    async openSheet(room: number, sheet: number, { socket = true } = {}): Promise<void> {
        await this.goto(`/room/sheet/view/${room}/${sheet}`);
        await this.waitForSheet(1, socket);
    }

    async openRoom(room: number): Promise<void> {
        await this.goto(`/room/view/${room}`);
        await this.page.waitForFunction(() => window.__e2e.socketOpen());
    }

    /** Clicks the sheet in the room list and waits for it to render. */
    async switchTo(sheet: number): Promise<void> {
        const before = await this.page.evaluate(() => window.__e2e.inserted);
        const link = this.page.locator(`a[href="/sheet/view/${sheet}"]`).first();
        await link.click();
        await this.waitForSheet(before + 1);
    }

    async reload(): Promise<void> {
        await this.page.reload();
        await this.waitForSheet(1);
    }

    private async goto(path: string): Promise<void> {
        const res = await this.page.goto(`${this.base}${path}`);
        if (new URL(this.page.url()).pathname.startsWith("/user/login")) {
            throw new Error(`Not signed in at ${this.base}; run: node scripts/perf/sheet-render.mjs login --base ${this.base}`);
        }
        if (!res?.ok()) throw new Error(`GET ${path}: ${res?.status()}`);
    }

    private async waitForSheet(inserted: number, socket = true): Promise<void> {
        await this.page.waitForFunction(([n, s]) => window.__e2e.inserted >= n && (!s || window.__e2e.socketOpen()), [inserted, socket] as const);
    }

    async sheetId(): Promise<number> {
        return Number(await this.page.evaluate(() => document.getElementById("charactersheet")?.dataset.sheetId));
    }

    /** The #sheet-state payload of the sheet on the page. */
    async sheetState(): Promise<{ content: any; rollDefaults: any; canEdit: boolean }> {
        return this.page.evaluate(() => JSON.parse(document.getElementById("sheet-state")!.textContent!));
    }

    /** The stored content of a sheet, as the export gives it. */
    async exported(sheet: number): Promise<any> {
        const res = await this.context.request.get(`${this.base}/sheet/export/${sheet}`);
        if (!res.ok()) throw new Error(`export ${sheet}: ${res.status()}`);
        return res.json();
    }

    // ─── Messages and rolls ──────────────────────────────────────────────────

    async sent(type?: string): Promise<Msg[]> {
        const all = await this.page.evaluate(() => window.__e2e.sent);
        return type ? all.filter(m => m.type === type) : all;
    }

    async received(type?: string): Promise<Msg[]> {
        const all = await this.page.evaluate(() => window.__e2e.received);
        return type ? all.filter(m => m.type === type) : all;
    }

    /**
     * Forgets the recorded messages and rolls. First waits for the edits still
     * in their 200 ms debounce, unless the caller has just settled them.
     */
    async clearRecords({ settle = true } = {}): Promise<void> {
        if (settle) await this.settledSheetMessages(300);
        await this.page.evaluate(() => {
            window.__e2e.sent.length = 0;
            window.__e2e.received.length = 0;
            window.__e2e.rolls.length = 0;
        });
    }

    /**
     * Sheet messages sent since the last clearRecords, once no new one has
     * come for `quiet` ms: edits are debounced by 200 ms.
     */
    async settledSheetMessages(quiet = 500): Promise<Msg[]> {
        const sheetTypes = new Set(["change", "batch", "createItem", "deleteItem", "positionsChanged", "moveItemBetweenGrids", "autocompleteApply"]);
        let last = -1;
        for (; ;) {
            await this.page.waitForTimeout(quiet);
            const now = (await this.sent()).length;
            if (now === last) break;
            last = now;
        }
        return (await this.sent()).filter(m => sheetTypes.has(m.type));
    }

    async waitSent(pred: (m: Msg) => boolean, what = "message"): Promise<Msg> {
        const found = await eventually(async () => (await this.sent()).find(pred), m => expect(m, `${this.name} sends ${what}`).toBeDefined());
        return found!;
    }

    async waitReceived(pred: (m: Msg) => boolean, what = "message"): Promise<Msg> {
        const found = await eventually(async () => (await this.received()).find(pred), m => expect(m, `${this.name} receives ${what}`).toBeDefined());
        return found!;
    }

    async blockRolls(block = true): Promise<void> {
        await this.page.evaluate(b => { window.__e2e.blockRolls = b; }, block);
    }

    async rolls(): Promise<Roll[]> {
        return this.page.evaluate(() => window.__e2e.rolls);
    }

    // ─── Sheet elements ──────────────────────────────────────────────────────

    async read(path: string): Promise<unknown> {
        return this.page.evaluate(p => window.__e2e.read(p), path);
    }

    /** Edits the field; waits for it first, as a field can come with the render of an edit before. */
    async write(path: string, value: unknown): Promise<void> {
        await eventually(() => this.exists(path), found => expect(found, `${this.name}: field ${path}`).toBe(true), 2000);
        await this.page.evaluate(([p, v]) => window.__e2e.write(p as string, v), [path, value] as const);
    }

    /** Waits until the field at `path` shows `value`. */
    async expectValue(path: string, value: unknown, timeout = 5000): Promise<void> {
        await eventually(() => this.read(path), v => expect(v, `${this.name}: ${path}`).toEqual(value), timeout);
    }

    async exists(q: Query | string): Promise<boolean> {
        return this.page.evaluate(q => !!window.__e2e.find(q), typeof q === "string" ? { path: q } : q);
    }

    async count(q: Query): Promise<number> {
        return this.page.evaluate(q => window.__e2e.findAll(q).length, q);
    }

    async layout(gridPath: string): Promise<string[][]> {
        return this.page.evaluate(p => window.__e2e.layout(p), gridPath);
    }

    async el(q: Query | string): Promise<ElementHandle<Element>> {
        const query = typeof q === "string" ? { path: q } : q;
        const handle = (await this.page.evaluateHandle(q => window.__e2e.find(q), query)).asElement();
        if (!handle) throw new Error(`${this.name}: no element ${JSON.stringify(query)}`);
        return handle;
    }

    /** A real click: the element must be visible and not covered. */
    async click(q: Query | string): Promise<void> {
        await (await this.el(q)).click();
    }

    async hasClass(q: Query | string, cls: string): Promise<boolean> {
        return (await this.el(q)).evaluate((el, c) => el.classList.contains(c), cls);
    }

    /** An attribute of the field at `path`, e.g. its placeholder. */
    async attr(path: string, name: string): Promise<string | null> {
        return this.page.evaluate(([p, n]) => window.__e2e.fields(p)[0]?.getAttribute(n) ?? null, [path, name]);
    }

    async isCollapsed(itemPath: string): Promise<boolean> {
        return this.hasClass(itemPath, "collapsed");
    }

    /** Expands or collapses the item with its own toggle button, which CSS shows on hover. */
    async setCollapsed(itemPath: string, collapsed: boolean): Promise<void> {
        if (await this.isCollapsed(itemPath) !== collapsed) {
            await (await this.el(itemPath)).hover();
            await this.click({ path: itemPath, sel: OWN_CONTROL(".toggle-button") });
        }
        await eventually(() => this.isCollapsed(itemPath), c => expect(c, `${itemPath} collapsed`).toBe(collapsed));
    }

    async openNavTab(tab: NavTab): Promise<void> {
        await this.click({ sel: `label[for="${NAV_TABS[tab]}"]` });
    }

    /** Opens the characteristics dropdown, where the conditions are. */
    async openCharacteristics(): Promise<void> {
        await this.openNavTab("player");
        if (!(await this.hasClass({ sel: ".char-dropdown-toggle" }, "active"))) await this.click({ sel: ".char-dropdown-toggle" });
    }

    async setDeleteMode(on: boolean): Promise<void> {
        if (await this.hasClass({ sel: ".container" }, "deletion-mode") !== on) await this.click({ sel: "#toggle-delete-mode" });
    }

    // ─── Grids ───────────────────────────────────────────────────────────────

    /** Clicks "＋ Add" in column `col` of the grid and returns the createItem it sends. */
    async add(gridPath: string, col = 0): Promise<Msg> {
        const before = (await this.sent("createItem")).length;
        await this.click({ path: gridPath, sel: ":scope > .layout-column > .add-slot > .add-button", nth: col });
        await eventually(async () => (await this.sent("createItem")).length, n => expect(n, `${this.name} adds to ${gridPath}`).toBe(before + 1));
        return (await this.sent("createItem"))[before];
    }

    /** Deletes the item in Delete Mode and returns the deleteItem it sends. */
    async remove(itemPath: string): Promise<Msg> {
        await this.setDeleteMode(true);
        await this.click({ path: itemPath, sel: OWN_CONTROL(".delete-button") });
        await this.setDeleteMode(false);
        return this.waitSent(m => m.type === "deleteItem" && m.path === itemPath, `deleteItem ${itemPath}`);
    }

    /** The centre of the element in viewport coordinates, scrolled into view. */
    async center(q: Query | string): Promise<{ x: number; y: number }> {
        const el = await this.el(q);
        await el.scrollIntoViewIfNeeded();
        const box = await el.boundingBox();
        if (!box) throw new Error(`${this.name}: ${JSON.stringify(q)} is not visible`);
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }

    /**
     * Presses the drag handle of the item and moves a little, so Sortable
     * starts the drag. Finish it with moveTo and drop.
     */
    async grab(itemPath: string): Promise<void> {
        const handle = await this.el({ path: itemPath, sel: OWN_CONTROL(".drag-handle") });
        await handle.scrollIntoViewIfNeeded();
        const box = (await handle.boundingBox())!;
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await this.page.mouse.move(x, y);
        await this.page.mouse.down();
        await this.page.mouse.move(x + 6, y + 6, { steps: 4 });
    }

    async moveTo(point: { x: number; y: number }, steps = 20): Promise<void> {
        await this.page.mouse.move(point.x, point.y, { steps });
    }

    async drop(): Promise<void> {
        await this.page.mouse.up();
        // Sortable animates for 150 ms.
        await this.page.waitForTimeout(300);
    }

    /** Drags the item onto the middle of `target`: Sortable puts it before or after it. */
    async drag(itemPath: string, target: Query | string, { above = false } = {}): Promise<void> {
        await this.grab(itemPath);
        const t = await this.el(target);
        const box = (await t.boundingBox())!;
        await this.moveTo({ x: box.x + box.width / 2, y: box.y + (above ? box.height * 0.25 : box.height * 0.75) });
        await this.drop();
    }

    /** No leftovers of a drag in the sheet. */
    async expectNoDragLeftovers(): Promise<void> {
        expect(await this.count({ sel: ".sortable-fallback, .sortable-ghost, .is-dragging, .drag-over" })).toBe(0);
    }
}
