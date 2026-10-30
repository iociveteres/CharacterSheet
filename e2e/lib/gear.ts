// Gear items of Pathfinder Crusade with their material, enchantments and the
// attacks linked to them, as a player picks them from the suggestions.
import { expect } from "vitest";
import type { Query } from "./probes";
import type { Player } from "./player";
import { addItem, grid, showGrid } from "./sheet";
import { eventually } from "./wait";

/** The text of the element, whitespace collapsed; null when it is not there. */
export async function textOf(p: Player, q: Query | string): Promise<string | null> {
    const query = typeof q === "string" ? { path: q } : q;
    return p.page.evaluate(q => {
        const el = window.__e2e.find(q);
        return el ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : null;
    }, query);
}

/** Waits until the element's text is `want`; null waits until it is gone. */
export async function expectText(p: Player, q: Query | string, want: string | null, timeout = 5000): Promise<void> {
    await eventually(() => textOf(p, q), t => expect(t, `${p.name}: text of ${JSON.stringify(q)}`).toBe(want), timeout);
}

/** The headings and options of the open suggestions, in order: headings as `# In Gear`, options as their name and type. */
export async function suggestions(p: Player): Promise<string[]> {
    return p.page.evaluate(() => window.__e2e.findAll({ sel: ".autocomplete-dropdown .autocomplete-group, .autocomplete-dropdown .ac-header" })
        .map(el => el.classList.contains("autocomplete-group")
            ? `# ${el.textContent}`
            : [el.querySelector(".ac-name")?.textContent, el.querySelector(".ac-type")?.textContent].filter(Boolean).join(" | ")));
}

/**
 * Clicks the suggestion `name` (`Mithral`, or `Longsword | Mithral` with its
 * type) once it is shown; after `group`, the first of that name under it.
 */
export async function pickSuggestion(p: Player, name: string, group?: string): Promise<void> {
    const shown = await eventually(() => suggestions(p), list => {
        const from = group ? list.indexOf(`# ${group}`) : 0;
        expect(from, `${p.name}: heading ${group}`).toBeGreaterThanOrEqual(0);
        expect(list.slice(from).some(s => matches(s, name)), `${p.name}: suggestion ${name} in ${JSON.stringify(list)}`).toBe(true);
    });
    const from = group ? shown.indexOf(`# ${group}`) : 0;
    const at = from + shown.slice(from).findIndex(s => matches(s, name));
    // The options before it, without the headings.
    const nth = shown.slice(0, at).filter(s => !s.startsWith("# ")).length;
    await p.click({ sel: ".autocomplete-dropdown .autocomplete-option", nth });
}

/** A suggestion's name is the entry's, or `English / Russian`. */
function matches(shown: string, name: string): boolean {
    if (shown.startsWith("# ")) return false;
    if (shown === name) return true;
    const [n, type] = shown.split(" | ");
    const english = n.split(" / ")[0];
    return name.includes(" | ") ? `${english} | ${type}` === name : english === name;
}

/** Clicks the field and types `text` as a player does. */
export async function typeInto(p: Player, q: Query | string, text: string): Promise<void> {
    await p.click(q);
    await p.page.keyboard.type(text);
}

/**
 * Adds a gear item and picks the rulebook's `name` for it by typing `query`;
 * the item is expanded. Returns its path.
 */
export async function addGear(p: Player, query: string, name: string): Promise<string> {
    const item = await addItem(p, await showGrid(p, grid("gear")));
    await typeInto(p, `${item}.name`, query);
    await pickSuggestion(p, name);
    await p.waitReceived(m => m.type === "autocompleteApplied" && m.path === item, `the gear ${name}`);
    await p.setCollapsed(item, false);
    return item;
}

/** Adds a gear item named `name`, which the rulebook does not have; expanded, of `gearType`. */
export async function addOwnGear(p: Player, name: string, gearType: string): Promise<string> {
    const item = await addItem(p, await showGrid(p, grid("gear")));
    await typeInto(p, `${item}.name`, name);
    await p.closeSuggestions();
    await p.setCollapsed(item, false);
    await (await p.el(`${item}.gearType`)).selectOption(gearType);
    return item;
}

/** Picks the material `name` of the gear item at `item` by typing `query` in its Material field. */
export async function pickMaterial(p: Player, item: string, query: string, name: string): Promise<void> {
    await typeInto(p, `${item}.material.name`, query);
    await pickSuggestion(p, name);
    await p.waitReceived(m => m.type === "autocompleteApplied" && m.path === `${item}.material`, `the material ${name}`);
}

/** The lines of what the material of the item does: the title of its Material field; none without a material. */
export async function materialEffects(p: Player, item: string): Promise<string[]> {
    const title = await (await p.el(`${item}.material.name`)).getAttribute("title");
    return title ? title.split("\n") : [];
}

/** Waits until the material's effects of the item begin with `want`; the material's own text follows them. */
export async function expectEffects(p: Player, item: string, want: string[]): Promise<void> {
    await eventually(() => materialEffects(p, item), lines => expect(lines.slice(0, want.length), `${p.name}: effects of ${item}`).toEqual(want));
}

/** The enchantments row of the gear item; there only while it has some, or one is being added. */
export const enchantmentsOf = (item: string) => `${item}.enchantments.items`;

/** The ＋ of the enchantments of an item without any, in its add line; its title has the item's capacity. */
export const addEnchantmentOf = (item: string) => `${item}.addLine.addEnchantment`;

/** Adds the enchantment `name` to the item with ＋ and its suggestions; returns its path, opened. */
export async function addEnchantment(p: Player, item: string, query: string, name: string): Promise<string> {
    const row = enchantmentsOf(item);
    // The ＋ of an item without enchantments is in its add line, the row is not there yet.
    if (await p.exists(row)) await p.click({ path: row, sel: ":scope > .mods-row > .add-mod" });
    else await p.click(addEnchantmentOf(item));
    await typeInto(p, { path: row, sel: ".mod-add input" }, query);
    await pickSuggestion(p, name);
    const apply = await p.waitSent(m => m.type === "autocompleteApply" && m.collection === "enchantments" && m.name === name, `the enchantment ${name}`);
    await p.waitReceived(m => m.type === "autocompleteApplied" && m.path === apply.path, `the enchantment ${name} applied`);
    return apply.path;
}

/** The chips of the enchantment row or mods row at `row`, `[open]` for the open one. */
export async function chips(p: Player, row: string): Promise<string[]> {
    return p.page.evaluate(path => window.__e2e.findAll({ path, sel: ":scope > .mods-row > .mod-chip" })
        .map(el => {
            const text = el.querySelector(".mod-chip-name")?.textContent ?? "";
            return el.classList.contains("open") ? `[${text}]` : text;
        }), row);
}

/** The level chips of the open enchantment at `path`, `[3]` for the chosen one. */
export async function levelChips(p: Player, path: string): Promise<string[]> {
    return p.page.evaluate(path => window.__e2e.findAll({ path, sel: ".level-chip" })
        .map(el => (el.classList.contains("selected") ? `[${el.textContent}]` : el.textContent ?? "")), path);
}

/** The lines of the ⚙ window's breakdown of the damage or pen at `path`, as `+1 Mithral (Longsword)`; the window must be open. */
export async function breakdown(p: Player, path: string, stat: "damage" | "pen"): Promise<string[]> {
    return p.page.evaluate(([path, stat]) => {
        const field = window.__e2e.findAll({ path, sel: `.layout-row.${stat} .breakdown` })[0]
            ?? window.__e2e.findAll({ path, sel: `.${stat} .breakdown` })[0];
        if (!field) return [];
        const out: string[] = [];
        const parts = Array.from(field.children);
        for (let i = 0; i + 1 < parts.length; i += 2) out.push(`${parts[i].textContent} ${parts[i + 1].textContent}`);
        return out;
    }, [path, stat] as const);
}
