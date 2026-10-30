// Attacks linked to gear items (state/itemLink.ts, blocks/ItemLink.tsx,
// blocks/LinkedAttacks.tsx): the In Gear group of an attack's name links it,
// "· gear" after the name marks it, an emptied name drops
// the link, ＋ attack of a gear weapon makes a linked attack and its chip
// shows it on Combat. The item's material Pen, its enchantments' Special and
// This-item entries, and Broken reach the linked attacks; a deleted item
// gives them nothing.
import { beforeAll, describe, expect, it } from "vitest";
import {
    addEnchantment, addGear, addOwnGear, breakdown, expectText, pickMaterial, pickSuggestion, suggestions, textOf, typeInto,
} from "../../lib/gear";
import type { Msg } from "../../lib/probes";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid, tabIds } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

const MELEE = "meleeAttacks.list.items";
const RANGED = "rangedAttacks.list.items";

describe("attack ↔ gear link", () => {
    const t = useTable("item-link", { kind: "pathfinder_crusade" });
    let sword = "";
    let swordId = "";
    let attack = "";
    let tab = "";

    const attacksRow = (item: string) => `${item}.attacks`;
    /** The ＋ attack of a weapon without attacks, in the item's add line. */
    const addAttackOf = (item: string) => `${item}.addLine.addAttack`;
    const mark = (attackPath: string) => `${attackPath}.linkMark`;
    const firstTab = async (p: Player, attackPath: string) => `${attackPath}.tabs.items.${(await tabIds(p, `${attackPath}.tabs.items`))[0]}`;
    const attackChips = (p: Player, item: string) => p.page.evaluate(path => window.__e2e.findAll({ path, sel: ".attack-chip .mod-chip-name" })
        .map(el => el.textContent), attacksRow(item));

    /** The attack created last by `p` in the block: its path. */
    const created = async (p: Player, block: string): Promise<string> => {
        const msg = (await p.sent("createItem")).filter(m => m.path === block).at(-1) as Msg;
        return `${block}.${msg.itemId}`;
    };

    /** The ⚙ window of the stat open on `p`, its breakdown read, and closed again. */
    async function windowLines(p: Player, path: string, stat: "damage" | "pen"): Promise<string[]> {
        await p.openMods(path, stat);
        const lines = await breakdown(p, path, stat);
        await p.closeDropdowns();
        return lines;
    }

    async function showItem(p: Player, item: string) {
        await p.openNavTab("gear");
        await p.setCollapsed(item, false);
    }

    beforeAll(async () => {
        const { a } = t;
        await a.openNavTab("player");
        await a.write("characteristics.S.value", "40");
        await a.write("characteristics.WS.value", "40");
        sword = await addGear(a, "Longs", "Longsword");
        swordId = sword.split(".").at(-1)!;
        await pickMaterial(a, sword, "Mith", "Mithral");
        const flaming = await addEnchantment(a, sword, "Flam", "Flaming");
        await a.click({ path: flaming, sel: ".level-chip", text: "3" });
        await a.blockRolls();
    });

    it("the In Gear group above Rulebook links the attack and fills it from the rulebook", async () => {
        const { a, b } = t;
        attack = await addItem(a, await showGrid(a, grid("meleeAttacks")));
        await a.clearRecords();
        await typeInto(a, `${attack}.name`, "Longs");
        await eventually(() => suggestions(a), s => {
            expect(s.slice(0, 3), "A: suggestions").toEqual(["# In Gear", "Longsword | Mithral · Flaming 3", "# Rulebook"]);
            expect(s, "A: the rulebook's").toContain("Longsword | Рукопашное оружие");
        });
        await pickSuggestion(a, "Longsword", "In Gear");
        const apply = await a.waitSent(m => m.type === "autocompleteApply" && m.path === attack, "the apply");
        expect(apply).toMatchObject({ collection: "melee", name: "Longsword", base: { item: swordId } });
        await a.waitReceived(m => m.type === "autocompleteApplied" && m.path === attack, "the attack applied");

        tab = await firstTab(a, attack);
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            await p.expectValue(`${attack}.name`, "Longsword");
            await expectText(p, mark(attack), "· gear");
            expect(await p.exists(`${attack}.item`), `${p.name}: no Item row`).toBe(false);
            // 1d10+2 and S.b 4.
            await p.expectValue(`${tab}.damageTotal`, "1d10+6");
            await p.expectValue(`${tab}.penTotal`, "1");
            await expectText(p, `${tab}.itemProperties`, "+ Flame (d10)");
        }
        // The material and enchantments are in the breakdowns of what they change.
        expect(await windowLines(a, tab, "pen")).toEqual(["+1 Mithral (Longsword)"]);
        expect(await (await b.el(`${tab}.itemProperties`)).getAttribute("title")).toBe("Flame (d10): the Flaming 3 enchantment of Longsword");
    });

    it("the mark sits inside the name's field, after the name, and lets a click through to the field", async () => {
        const { a } = t;
        await a.openNavTab("combat");
        const box = await a.page.evaluate(([name, markPath]) => {
            const input = window.__e2e.fields(name)[0] as HTMLInputElement;
            const m = window.__e2e.find({ path: markPath })!;
            const i = input.getBoundingClientRect();
            const r = m.getBoundingClientRect();
            return { inside: r.left >= i.left && r.right <= i.right && r.top >= i.top && r.bottom <= i.bottom, after: r.left > i.left + 20 };
        }, [`${attack}.name`, mark(attack)] as const);
        expect(box).toEqual({ inside: true, after: true });
        expect(await (await a.el(`${attack}.name`)).getAttribute("title")).toContain("From the gear");
        // A mouse click where the mark is: the field under it gets it.
        const at = await a.center(mark(attack));
        await a.page.mouse.click(at.x, at.y);
        await eventually(() => a.page.evaluate(() => (window.__e2e.root().activeElement as HTMLElement | null)?.dataset.id ?? null),
            id => expect(id, "the name focused").toBe("name"));
        await a.closeSuggestions();
        await a.closeDropdowns();
    });

    it("the In Gear group leaves out a weapon another attack of the block is linked to", async () => {
        const { a } = t;
        const other = await addItem(a, await showGrid(a, grid("meleeAttacks")));
        await a.clearRecords();
        await typeInto(a, `${other}.name`, "Longs");
        await eventually(() => suggestions(a), s => {
            expect(s, "A: the rulebook's").toContain("Longsword | Рукопашное оружие");
            expect(s.filter(h => h.startsWith("# ")), "A: no headings without In Gear").toEqual([]);
        });
        await a.closeSuggestions();
        await a.remove(other);
    });

    it("an emptied name drops the link, the In Gear pick takes it again", async () => {
        const { a, b } = t;
        await a.openNavTab("combat");
        await a.click(`${attack}.name`);
        await a.page.keyboard.press("Control+A");
        await a.page.keyboard.press("Backspace");
        await a.closeSuggestions();
        // Leaving the field ends the edit.
        await a.page.keyboard.press("Tab");
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            await expectText(p, mark(attack), null);
            await p.expectValue(`${tab}.penTotal`, "0");
            await eventually(() => p.exists(`${tab}.itemProperties`), shown => expect(shown, `${p.name}: Special added`).toBe(false));
        }

        await a.clearRecords();
        await typeInto(a, `${attack}.name`, "Longs");
        await pickSuggestion(a, "Longsword", "In Gear");
        await a.waitReceived(m => m.type === "autocompleteApplied" && m.path === attack, "the attack applied again");
        // The pick fills the attack anew: its tab too.
        tab = await firstTab(b, attack);
        await expectText(b, mark(attack), "· gear");
        await b.expectValue(`${tab}.penTotal`, "1");
        await expectText(b, `${tab}.itemProperties`, "+ Flame (d10)");
    });


    it("the Attacks chip of the gear item opens Combat and flashes the attack", async () => {
        const { a } = t;
        await showItem(a, sword);
        await eventually(() => attackChips(a, sword), c => expect(c, "chips").toEqual(["⚔ Longsword"]));
        await a.click({ path: attacksRow(sword), sel: ".attack-chip .mod-chip-name" });
        await eventually(() => a.page.evaluate(() => (window.__e2e.root().getElementById("show-combat") as HTMLInputElement).checked),
            open => expect(open, "Combat open").toBe(true));
        await eventually(() => a.hasClass(attack, "link-flash"), flash => expect(flash, "the attack flashes").toBe(true));
        expect(await (await a.el(attack)).isVisible()).toBe(true);
    });

    it("＋ attack of a rulebook melee weapon makes a linked melee attack", async () => {
        const { a, b } = t;
        await showItem(a, sword);
        await a.click(`${attacksRow(sword)}.addAttack`);
        await eventually(() => attackChips(a, sword), c => expect(c, "chips").toEqual(["⚔ Longsword", "⚔ Longsword"]));
        const second = await created(a, MELEE);
        await a.waitReceived(m => m.type === "autocompleteApplied" && m.path === second, "the new attack applied");
        await b.openNavTab("combat");
        await expectText(b, mark(second), "· gear");
        const secondTab = await firstTab(b, second);
        await b.expectValue(`${secondTab}.damageTotal`, "1d10+6");
        await b.expectValue(`${secondTab}.penTotal`, "1");
        await a.openNavTab("combat");
        await a.remove(second);
    });

    it("＋ attack of an own-named weapon, in its add line, makes an empty melee attack of its name, linked", async () => {
        const { a, b } = t;
        const stick = await addOwnGear(a, "Grandpa's Stick", "weapon");
        expect(await a.exists(attacksRow(stick)), "no Attacks row without attacks").toBe(false);
        await a.click(addAttackOf(stick));
        await eventually(() => attackChips(a, stick), c => expect(c, "chips").toEqual(["⚔ Grandpa's Stick"]));
        const made = await created(a, MELEE);
        await b.openNavTab("combat");
        await b.expectValue(`${made}.name`, "Grandpa's Stick");
        await expectText(b, mark(made), "· gear");
        const madeTab = await firstTab(b, made);
        // No damage of its own, the Strength bonus as its modifier.
        await b.openMods(madeTab, "damage");
        const mods = (await b.layout(`${madeTab}.damageMods.items`)).flat();
        expect(await Promise.all(mods.map(id => b.read(`${madeTab}.damageMods.items.${id}.expr`)))).toEqual(["S.b"]);
        await b.closeDropdowns();
        await a.openNavTab("combat");
        await a.remove(made);
        await showItem(a, stick);
        await a.remove(stick);
    });

    it("Broken: the damage window notes ½ after armour, and so does the roll in the chat", async () => {
        const { a, b } = t;
        await showItem(a, sword);
        await a.click(`${sword}.broken`);
        await b.openNavTab("combat");
        await b.openMods(tab, "damage");
        await expectText(b, { path: tab, sel: ".layout-row.damage [data-id=note]" }, "½ after armour: Longsword is broken");
        await b.closeDropdowns();
        // The total keeps the dice: the hit is halved after armour.
        await b.expectValue(`${tab}.damageTotal`, "1d10+6");

        await a.openNavTab("combat");
        await a.clearRecords();
        await a.click({ path: tab, sel: ".layout-row.damage label.rollable" });
        await eventually(() => a.rolls(), r => expect(r.at(-1)?.label, "the roll's label").toMatch(/\(broken: ½ after armour\)$/));
        const chat = await a.waitSent(m => m.type === "chatMessage", "the roll");
        expect(String(chat.messageBody)).toContain("(broken: ½ after armour)");

        await showItem(a, sword);
        await a.click(`${sword}.broken`);
        await b.openNavTab("combat");
        await b.openMods(tab, "damage");
        await eventually(() => b.exists({ path: tab, sel: ".layout-row.damage [data-id=note]" }), shown => expect(shown, "no note").toBe(false));
        await b.closeDropdowns();
    });

    it("Self-Balancing, a This-item entry, adds to the Balance of the linked attack", async () => {
        const { a, b } = t;
        // Held one-handed, Balance 2 − 1: below the limit of 2.
        await a.openNavTab("combat");
        await a.click({ path: attack, sel: ".grip-chip", text: "1h" });
        await b.openNavTab("combat");
        await b.expectValue(`${attack}.balanceTotal`, "1");
        await showItem(a, sword);
        await addEnchantment(a, sword, "Self-B", "Self-Balancing");
        await b.openNavTab("combat");
        await b.expectValue(`${attack}.balanceTotal`, "2");
        await b.click({ path: attack, sel: ".layout-row.balance .mod-toggle" });
        expect(await textOf(b, { path: attack, sel: ".layout-row.balance .breakdown" })).toContain("+1Self-Balancing (Longsword)");
        await b.closeDropdowns();
        await a.openNavTab("combat");
        await a.click({ path: attack, sel: ".grip-chip", text: "2h" });
        await b.expectValue(`${attack}.balanceTotal`, "2");
    });

    it("Distance doubles the range of a linked ranged attack made with ＋ attack", async () => {
        const { a, b } = t;
        const bow = await addGear(a, "Longb", "Longbow");
        await a.click(addAttackOf(bow));
        await eventually(() => attackChips(a, bow), c => expect(c, "chips").toEqual(["➶ Longbow"]));
        const shot = await created(a, RANGED);
        await a.waitReceived(m => m.type === "autocompleteApplied" && m.path === shot, "the ranged attack applied");
        await b.openNavTab("combat");
        await expectText(b, mark(shot), "· gear");
        const before = String(await eventually(() => b.read(`${shot}.rangeTotal`), v => expect(v, "range").toMatch(/^\d+/)));

        await showItem(a, bow);
        await addEnchantment(a, bow, "Dista", "Distance");
        await b.openNavTab("combat");
        await eventually(() => b.read(`${shot}.rangeTotal`),
            v => expect(parseInt(String(v), 10), `range after Distance, was ${before}`).toBe(2 * parseInt(before, 10)));
        await a.openNavTab("combat");
        await a.remove(shot);
    });

    it("a deleted gear item: the mark says deleted, dimmed, and the additions are gone", async () => {
        const { a, b } = t;
        await showItem(a, sword);
        await a.remove(sword);
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            await expectText(p, mark(attack), "· deleted");
            expect(await p.hasClass(mark(attack), "dimmed"), `${p.name}: dimmed`).toBe(true);
            await p.expectValue(`${tab}.penTotal`, "0");
            await p.expectValue(`${attack}.balanceTotal`, "2");
            await eventually(() => p.exists(`${tab}.itemProperties`), shown => expect(shown, `${p.name}: Special added`).toBe(false));
        }
    });
});
