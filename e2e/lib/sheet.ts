// The item grids of the Black Crusade sheet and how to get to them.
import { expect } from "vitest";
import type { Msg } from "./probes";
import type { NavTab, Player } from "./player";
import { eventually } from "./wait";

export interface GridSpec {
    name: string;
    /** State path of the grid; empty for powers, whose grids are in tabs (see showGrid). */
    path: string;
    tab: NavTab;
    columns: number;
    /** New item ids start with `${prefix}-`. */
    prefix: string;
    /** Class of an item's root element. */
    itemClass: string;
    /** Powers live in the grids of Psykana or Techno Arcana tabs. */
    powers?: "psykana" | "technoArcana";
}

const list = (name: string, tab: NavTab, columns: number, prefix: string, itemClass = "item-with-description"): GridSpec =>
    ({ name, path: `${name}.list.items`, tab, columns, prefix, itemClass });

export const GRIDS: readonly GridSpec[] = [
    list("customSkills", "player", 1, "custom-skills", "custom-skill"),
    list("notes", "player", 1, "notes"),
    list("conditions", "player", 2, "conditions", "condition-item"),
    list("resourceTrackers", "combat", 2, "resource-trackers", "resource-tracker"),
    list("powerShields", "combat", 1, "power-shields", "power-shield"),
    list("rangedAttacks", "combat", 1, "ranged-attack", "ranged-attack"),
    list("meleeAttacks", "combat", 1, "melee-attack", "melee-attack"),
    list("traits", "talents", 3, "traits"),
    list("talents", "talents", 3, "talents"),
    list("gear", "gear", 3, "gear", "gear-item"),
    list("cybernetics", "gear", 3, "cybernetics"),
    { name: "experienceLog", path: "experience.experienceLog.items", tab: "advancements", columns: 3, prefix: "experience-log", itemClass: "experience-item" },
    list("mutations", "advancements", 1, "mutations"),
    list("mentalDisorders", "advancements", 1, "mental-disorders"),
    list("diseases", "advancements", 1, "diseases"),
    { name: "psychicPowers", path: "", tab: "psykana", columns: 2, prefix: "psychic-powers", itemClass: "psychic-power", powers: "psykana" },
    { name: "techPowers", path: "", tab: "techno", columns: 2, prefix: "tech-powers", itemClass: "tech-power", powers: "technoArcana" },
];

export const grid = (name: string): GridSpec => {
    const g = GRIDS.find(g => g.name === name);
    if (!g) throw new Error(`No grid ${name}`);
    return g;
};

/** Clicks the add button of the tabs at `tabsPath` and returns the createItem it sends. */
export async function addTab(p: Player, tabsPath: string): Promise<Msg> {
    const before = (await p.sent("createItem")).length;
    await p.click({ path: tabsPath, sel: ":scope > .add-tab-btn" });
    await eventually(async () => (await p.sent("createItem")).length, n => expect(n, `adds a tab to ${tabsPath}`).toBe(before + 1));
    return (await p.sent("createItem"))[before];
}

/** Tab ids of the tabs at `tabsPath` in their order. */
export async function tabIds(p: Player, tabsPath: string): Promise<string[]> {
    return p.page.evaluate(path => {
        const tabs = window.__e2e.find({ path })!;
        return Array.from(tabs.children)
            .filter(el => el.classList.contains("tablabel") && !el.classList.contains("sortable-fallback"))
            .map(el => (el as HTMLElement).dataset.id!);
    }, tabsPath);
}

/** The id of the open tab of the tabs at `tabsPath`. */
export async function openTab(p: Player, tabsPath: string): Promise<string | null> {
    return p.page.evaluate(path => {
        const tabs = window.__e2e.find({ path })!;
        const radio = Array.from(tabs.children).find(el => el.matches("input.radiotab:checked"));
        return radio ? radio.id : null;
    }, tabsPath);
}

/**
 * Opens the tab by a click on its label, off the field and buttons inside it:
 * a click on those does not activate the label.
 */
export async function selectTab(p: Player, tabsPath: string, tabId: string): Promise<void> {
    const label = await p.el({ path: tabsPath, sel: `:scope > label.tablabel[for="${tabId}"]` });
    await label.scrollIntoViewIfNeeded();
    const point = await label.evaluate(el => {
        const r = el.getBoundingClientRect();
        const root = el.getRootNode() as ShadowRoot;
        for (let y = r.top + 2; y < r.bottom; y += 3) {
            for (let x = r.left + 2; x < r.right; x += 3) {
                if (root.elementFromPoint(x, y) === el) return { x, y };
            }
        }
        return null;
    });
    if (!point) throw new Error(`No free spot on the label of tab ${tabId}`);
    await p.page.mouse.click(point.x, point.y);
    await eventually(() => openTab(p, tabsPath), id => expect(id, "open tab").toBe(tabId));
}

/**
 * Shows the grid on A's screen and returns its state path. Powers get a
 * tab first when the block has none; the grid of the open tab is used.
 */
export async function showGrid(p: Player, g: GridSpec): Promise<string> {
    if (g.name === "conditions") await p.openCharacteristics();
    else await p.openNavTab(g.tab);
    if (!g.powers) return g.path;

    const tabsPath = `${g.powers}.tabs.items`;
    if ((await tabIds(p, tabsPath)).length === 0) await addTab(p, tabsPath);
    const tab = (await openTab(p, tabsPath))!;
    return `${tabsPath}.${tab}.powers.items`;
}

/** The DOM id prefix of new items of the grid at `gridPath`. */
export function idPrefix(g: GridSpec, gridPath: string): string {
    if (!g.powers) return g.prefix;
    const tab = gridPath.split(".")[3];
    return `${g.prefix}-${tab}`;
}

/** The positions a grid laid out as `layout` (ids by column) sends in positionsChanged. */
export function positionsOf(layout: string[][]): { [id: string]: { colIndex: number; rowIndex: number } } {
    const out: { [id: string]: { colIndex: number; rowIndex: number } } = {};
    layout.forEach((col, colIndex) => col.forEach((id, rowIndex) => { out[id] = { colIndex, rowIndex }; }));
    return out;
}

/** Adds an item to column `col` of the grid and returns its path. */
export async function addItem(p: Player, gridPath: string, col = 0): Promise<string> {
    const msg = await p.add(gridPath, col);
    return `${gridPath}.${msg.itemId}`;
}
