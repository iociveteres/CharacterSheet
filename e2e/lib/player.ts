// A player: a browser context with a room page, and what the scenarios do
// with the sheet in it.
import { expect } from "vitest";
import { chromium, type Browser, type BrowserContext, type ElementHandle, type Page, type WebSocketRoute } from "playwright-core";
import { config, seedUser, type SeedRole } from "./config";
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

/** The navigation tab of the block at the start of `path`, for the items that open a dropdown. */
function navTabOf(path: string): NavTab {
    const block = path.split(".")[0];
    if (block === "psykana") return "psykana";
    if (block === "technoArcana") return "techno";
    if (["rangedAttacks", "meleeAttacks", "powerShields", "armour", "initiative"].includes(block)) return "combat";
    throw new Error(`No navigation tab known for ${path}`);
}

const tabName = (radioId: string) => Object.keys(NAV_TABS).find(k => NAV_TABS[k as NavTab] === radioId) ?? radioId;

export type ArmourPart = "head" | "leftArm" | "body" | "rightArm" | "leftLeg" | "rightLeg";

/** An item's own drag handle or delete button, not those of the grids inside it. */
const OWN_CONTROL = (cls: string) => `:scope > .split-header ${cls}, :scope > ${cls}`;

export type GateMode = "pass" | "hold" | "refuse";

/**
 * What happens to the room connections a player's page opens: they go through
 * to the server, wait until the mode changes, or are closed at once, as by a
 * server that is gone. See Player.gateSockets.
 */
export class SocketGate {
    mode: GateMode = "pass";
    /** Connections the page has tried since the gate was set up. */
    attempts = 0;
    private held: (() => void)[] = [];

    set(mode: GateMode): void {
        this.mode = mode;
        if (mode !== "hold") for (const release of this.held.splice(0)) release();
    }

    async handle(ws: WebSocketRoute): Promise<void> {
        this.attempts++;
        // The page's socket stays CONNECTING until the handler returns.
        while (this.mode === "hold") await new Promise<void>(r => this.held.push(r));
        if (this.mode === "refuse") await ws.close();
        else ws.connectToServer();
    }
}

export async function launch(): Promise<Browser> {
    return chromium.launch({ channel: "chrome", headless: !config.headed });
}

export class Player {
    /** console.error, console.warn and uncaught errors since the last takeErrors. */
    private errors: string[] = [];
    private ignored = [...IGNORED];

    private constructor(readonly name: string, readonly context: BrowserContext, readonly page: Page, readonly base: string) {
        page.on("console", m => {
            if (m.type() !== "error" && m.type() !== "warning") return;
            if (this.ignored.some(re => re.test(m.text()))) return;
            this.errors.push(`${m.type()}: ${m.text()}`);
        });
        page.on("pageerror", e => this.errors.push(`pageerror: ${e.message}`));
    }

    /** A player signed in with `auth`, or as the seeded user of `role` (config.seed). */
    static async create(browser: Browser, name: string, { base = config.base, auth = config.auth, role }: { base?: string; auth?: string; role?: SeedRole } = {}): Promise<Player> {
        if (role) auth = seedUser(role).auth;
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

    /** Console messages matching one of `patterns` are no errors from now on. */
    allowErrors(...patterns: RegExp[]): void {
        this.ignored.push(...patterns);
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

    /**
     * Routes the page's room connections through a gate. The page is reloaded:
     * Playwright's mock socket only goes into documents loaded after the route.
     */
    async gateSockets(): Promise<SocketGate> {
        const gate = new SocketGate();
        await this.context.routeWebSocket(/\/room\/ws\//, ws => gate.handle(ws));
        await this.reload();
        return gate;
    }

    /** Closes the room's socket from the page; room/socket.js then reconnects as after a dropped connection. */
    async dropSocket(): Promise<void> {
        await this.page.evaluate(() => {
            const socket = window.__e2e.sockets.findLast(s => s.readyState === WebSocket.OPEN);
            if (!socket) throw new Error("No open socket");
            socket.close();
        });
    }

    /** Waits until the sheet has shown `message` as a toast of the room page. */
    async expectNotice(message: string, timeout = 5000): Promise<void> {
        await eventually(async () => ({
            notices: await this.page.evaluate(() => window.__e2e.notices),
            toasts: await this.page.locator(".toasts > .toast").allTextContents(),
        }), ({ notices, toasts }) => {
            expect(notices, `${this.name}: notices`).toContain(message);
            expect(toasts.map(s => s.trim()), `${this.name}: toasts`).toContain(message);
        }, timeout);
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

    /** What the server sends for the sheet on the page, as its room list gets it. */
    async sheetState(): Promise<{ content: any; rollDefaults: any; canEdit: boolean }> {
        const res = await this.context.request.get(`${this.base}/sheet/view/${await this.sheetId()}`);
        if (!res.ok()) throw new Error(`sheet view: ${res.status()}`);
        return res.json();
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
        if (settle) await this.settledSheetMessages();
        await this.page.evaluate(() => {
            window.__e2e.sent.length = 0;
            window.__e2e.received.length = 0;
            window.__e2e.rolls.length = 0;
            window.__e2e.rollRequests.length = 0;
            window.__e2e.rollResults.length = 0;
            window.__e2e.notices.length = 0;
        });
    }

    /**
     * Sheet messages sent since the last clearRecords, once no new one has
     * come for `quiet` ms. Edits are debounced by 200 ms, so one quiet window
     * longer than that has seen every edit made before the call.
     */
    async settledSheetMessages(quiet = 300): Promise<Msg[]> {
        const sheetTypes = new Set(["change", "batch", "createItem", "deleteItem", "positionsChanged", "moveItemBetweenGrids", "autocompleteApply"]);
        let last = (await this.sent()).length;
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

    /**
     * Answers the sheet's last d100 test as the room does once the server's
     * message is back, with `outcome` over a plain success: a blocked roll
     * never gets its answer, and a real one is random.
     */
    async answerRoll(outcome: { roll?: number; success?: boolean; degrees?: number; doubles?: boolean } = {}): Promise<void> {
        await this.page.evaluate(o => {
            const requestId = window.__e2e.rollRequests.at(-1);
            if (!requestId) throw new Error("No test to answer");
            const answer = { roll: 50, target: 50, success: true, degrees: 1, crit: false, doubles: false, ...o };
            document.dispatchEvent(new CustomEvent("sheet:rollResult", { detail: { requestId, outcome: answer } }));
        }, outcome);
    }

    async rollResults(): Promise<{ requestId: string; outcome: unknown }[]> {
        return this.page.evaluate(() => window.__e2e.rollResults);
    }

    async rolls(): Promise<Roll[]> {
        return this.page.evaluate(() => window.__e2e.rolls);
    }

    // ─── Sheet elements ──────────────────────────────────────────────────────

    /**
     * Why a user could not use the element: null when it is shown. The player
     * opens nothing itself, the scenario does, as a user would.
     */
    private async problem(q: Query): Promise<string | null> {
        const where = await this.page.evaluate(q => {
            const el = window.__e2e.find(q);
            return el ? window.__e2e.closedTab(el) ?? "shown" : "missing";
        }, q);
        if (where === "shown") return null;
        if (where === "missing") return "is not rendered: open the tab or the dropdown it is in";
        return `is in the closed tab ${tabName(where)}: open it with openNavTab`;
    }

    private async shown(q: Query, what: string): Promise<void> {
        const problem = await this.problem(q);
        if (problem) throw new Error(`${this.name}: ${what} ${problem}`);
    }

    async read(path: string): Promise<unknown> {
        await this.shown({ path }, `field ${path}`);
        return this.page.evaluate(p => window.__e2e.read(p), path);
    }

    /** Edits the field; waits for it first, as a field can come with the render of an edit before. */
    async write(path: string, value: unknown): Promise<void> {
        await eventually(() => this.problem({ path }), problem => expect(problem, `${this.name}: field ${path}`).toBeNull(), 2000);
        // A select of Test Options gets its options on focus, in a render after the event (blocks/TestOptions.tsx).
        await this.page.evaluate(p => window.__e2e.fields(p)[0].focus(), path);
        await this.page.evaluate(([p, v]) => window.__e2e.write(p as string, v), [path, value] as const);
    }

    /** Waits until the field at `path` shows `value`. */
    async expectValue(path: string, value: unknown, timeout = 5000): Promise<void> {
        await eventually(async () => ({ problem: await this.problem({ path }), v: await this.page.evaluate(p => window.__e2e.read(p), path) }), ({ problem, v }) => {
            expect(problem, `${this.name}: field ${path}`).toBeNull();
            expect(v, `${this.name}: ${path}`).toEqual(value);
        }, timeout);
    }

    /** Whether the element is there for a user: rendered and not in a closed tab. */
    async exists(q: Query | string): Promise<boolean> {
        return (await this.problem(typeof q === "string" ? { path: q } : q)) === null;
    }

    async count(q: Query): Promise<number> {
        return this.page.evaluate(q => window.__e2e.findAll(q).length, q);
    }

    async layout(gridPath: string): Promise<string[][]> {
        await this.shown({ path: gridPath }, `grid ${gridPath}`);
        return this.page.evaluate(p => window.__e2e.layout(p), gridPath);
    }

    async el(q: Query | string): Promise<ElementHandle<Element>> {
        const query = typeof q === "string" ? { path: q } : q;
        await this.shown(query, `element ${JSON.stringify(query)}`);
        return (await this.page.evaluateHandle(q => window.__e2e.find(q), query)).asElement()!;
    }

    /** A real click: the element must be visible and not covered. */
    async click(q: Query | string): Promise<void> {
        await (await this.el(q)).click();
    }

    async hasClass(q: Query | string, cls: string): Promise<boolean> {
        return (await this.el(q)).evaluate((el, c) => el.classList.contains(c), cls);
    }

    /** An attribute of the field at `path`, e.g. its placeholder; null without the field too. */
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

    /** Clicks the tab's label unless the tab is open: a click anywhere closes the open dropdowns. */
    async openNavTab(tab: NavTab): Promise<void> {
        const open = await this.page.evaluate(id => (window.__e2e.root().getElementById(id) as HTMLInputElement).checked, NAV_TABS[tab]);
        if (!open) await this.click({ sel: `label[for="${NAV_TABS[tab]}"]` });
    }

    /** Closes the open dropdowns with a click off them, on the open tab's label: they can hang over what is clicked next. */
    async closeDropdowns(): Promise<void> {
        const tab = await this.page.evaluate(() => window.__e2e.root().querySelector("#navigation-tabs > .radiotab:checked")!.id);
        await this.click({ sel: `label[for="${tab}"]` });
    }

    /**
     * Opens the navigation tab, then the dropdown with a real click on
     * `toggle` unless `content` is shown. A closed dropdown is not rendered.
     */
    private async openDropdown(tab: NavTab, toggle: Query, content: Query, what: string): Promise<void> {
        await this.openNavTab(tab);
        if (await this.exists(content)) return;
        await this.closeDropdowns();
        await this.click(toggle);
        await eventually(() => this.exists(content), found => expect(found, `${this.name}: ${what}`).toBe(true));
    }

    /** Opens the characteristics dropdown, where the conditions are. */
    async openCharacteristics(): Promise<void> {
        await this.openNavTab("player");
        if (!(await this.hasClass({ sel: ".char-dropdown-toggle" }, "active"))) await this.click({ sel: ".char-dropdown-toggle" });
    }

    /** Opens the roll dropdown of the attack or power by a click on its name. */
    async openRoll(itemPath: string): Promise<void> {
        await this.openDropdown(navTabOf(itemPath), { path: itemPath, sel: ":scope > .split-header .rollable" }, { path: `${itemPath}.roll` }, `roll of ${itemPath}`);
    }

    /**
     * Opens the dropdown of the damage or penetration of an attack, melee
     * profile or psychic power, which holds its own value.
     */
    async openMods(itemPath: string, stat: "damage" | "pen"): Promise<void> {
        await this.openDropdown(navTabOf(itemPath), { path: itemPath, sel: `.layout-row.${stat} .mod-toggle` }, { path: `${itemPath}.${stat}` }, `${stat} of ${itemPath}`);
    }

    /** Opens the ⚙ of the heading of the block, where its Test Options are. */
    async openTestOptions(block: "rangedAttacks" | "meleeAttacks" | "psykana" | "technoArcana"): Promise<void> {
        await this.openDropdown(navTabOf(block), { path: block, sel: ".block-settings-toggle" }, { path: `${block}.testOptions.items` }, `test options of ${block}`);
    }

    /** Opens the initiative settings: dice, bases and bonus. */
    async openInitiative(): Promise<void> {
        await this.openDropdown("combat", { sel: ".initiative-dropdown-toggle" }, { path: "initiative" }, "initiative settings");
    }

    /** Opens the extras of an armour part: its own armour fields and extra armour. */
    async openArmourPart(part: ArmourPart): Promise<void> {
        const path = `armour.${part}`;
        await this.openDropdown("combat", { path, sel: ".armour-extra-toggle" }, { path, sel: ".armour-extra-dropdown" }, `extras of ${path}`);
    }

    /** Opens the compensation roll of techno arcana. */
    async openCompensation(): Promise<void> {
        const path = "technoArcana.compensationRoll";
        await this.openDropdown("techno", { path, sel: ".compensation-toggle" }, { path, sel: ".compensation-dropdown" }, "compensation roll");
    }

    /**
     * Waits for the suggestions of the names typed so far and closes them, as
     * a player who saw them would. A click before they come does not stop
     * them, and they can cover what the player clicks next.
     */
    async closeSuggestions(): Promise<void> {
        await this.settledSheetMessages();
        for (const query of await this.sent("autocomplete")) {
            await this.waitReceived(m => m.type === "autocompleteResult" && m.eventID === query.eventID, "the suggestions");
        }
        if (await this.count({ sel: ".autocomplete-dropdown" }) === 0) return;
        await this.closeDropdowns();
        await eventually(() => this.count({ sel: ".autocomplete-dropdown" }), n => expect(n, `${this.name}: suggestions`).toBe(0));
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
