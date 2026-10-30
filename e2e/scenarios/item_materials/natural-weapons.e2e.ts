// Natural Weapons attacks linked to their trait (state/traitLink.ts,
// blocks/TraitLink.tsx): the In Traits group of a melee attack's name offers
// the profiles of the sheet's Natural Weapons traits, a pick links the attack,
// and X of the trait's name counts live in damage, and in Pen when Deadly. A
// pick from the Rulebook group puts X in as modifiers instead. Black Crusade
// has no such group nor row.
import { beforeAll, describe, expect, it } from "vitest";
import { addGear, breakdown, pickSuggestion, suggestions, typeInto } from "../../lib/gear";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid, tabIds } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

const firstTab = async (p: Player, attack: string) => `${attack}.tabs.items.${(await tabIds(p, `${attack}.tabs.items`))[0]}`;

/** Adds a trait named `name`, typed: the rulebook's suggestions are closed unpicked. */
async function addTrait(p: Player, name: string): Promise<string> {
    const trait = await addItem(p, await showGrid(p, grid("traits")));
    await typeInto(p, `${trait}.name`, name);
    await p.closeSuggestions();
    return trait;
}

/** Renames the trait as a player does: the whole name selected and typed over. */
async function renameTrait(p: Player, trait: string, name: string): Promise<void> {
    await p.openNavTab("talents");
    await p.click(`${trait}.name`);
    await p.page.keyboard.press("Control+A");
    await p.page.keyboard.type(name);
    await p.closeSuggestions();
}

/** A new melee attack with `query` typed in its name, the suggestions shown. */
async function attackTyping(p: Player, query: string): Promise<string> {
    const attack = await addItem(p, await showGrid(p, grid("meleeAttacks")));
    await p.clearRecords();
    await typeInto(p, `${attack}.name`, query);
    await p.waitReceived(m => m.type === "autocompleteResult", "the rulebook's suggestions");
    return attack;
}

/** The modifiers of the damage or pen of the profile at `tab` as `p` shows them in the open ⚙: `S.b`, `3 off`, `X off invalid`. */
async function modifiers(p: Player, tab: string, stat: "damage" | "pen"): Promise<string[]> {
    const grid = `${tab}.${stat}Mods.items`;
    const ids = (await p.layout(grid)).flat();
    return Promise.all(ids.map(async id => {
        const mod = `${grid}.${id}`;
        const flags = [(await p.read(`${mod}.enabled`)) ? "" : "off", (await p.hasClass(`${mod}.expr`, "invalid")) ? "invalid" : ""];
        return [await p.read(`${mod}.expr`), ...flags].filter(Boolean).join(" ");
    }));
}

describe("Natural Weapons linked to traits", () => {
    const t = useTable("natural-weapons", { kind: "pathfinder_crusade" });
    let natural = "";
    let deadly = "";
    let claws = "";
    let clawsTab = "";

    const traitOf = (path: string) => path.split(".").at(-1)!;

    async function damage(p: Player, tab: string, want: string, stat: "damage" | "pen" = "damage") {
        await p.openNavTab("combat");
        await p.expectValue(`${tab}.${stat}Total`, want);
    }

    beforeAll(async () => {
        const { a } = t;
        await a.openNavTab("player");
        await a.write("characteristics.S.value", "40");
        // A gear weapon: the Item row is there to give way to the Trait row.
        await addGear(a, "Longs", "Longsword");
        natural = await addTrait(a, "Natural Weapons (2)");
        await a.blockRolls();
    });

    it("In Traits offers the trait's profiles; a pick links the attack, X counts in its damage", async () => {
        const { a, b } = t;
        claws = await attackTyping(a, "cla");
        await eventually(() => suggestions(a), s => {
            expect(s.slice(0, 2), "A: the trait's").toEqual(["# In Traits", "Claws (Natural Weapons) / Когти | Natural Weapons (2)"]);
            expect(s, "A: the rulebook's after").toContain("# Rulebook");
        });
        // Not linked yet: both rows to choose from.
        expect(await a.exists(`${claws}.item`), "Item row").toBe(true);
        expect(await a.exists(`${claws}.trait`), "Trait row").toBe(true);

        await pickSuggestion(a, "Claws (Natural Weapons)", "In Traits");
        const apply = await a.waitSent(m => m.type === "autocompleteApply" && m.path === claws, "the apply");
        expect(apply).toMatchObject({ collection: "melee", name: "Claws (Natural Weapons)", base: { trait: traitOf(natural) } });
        expect(apply.rating, "no X modifiers on a linked pick").toBeUndefined();
        await a.waitReceived(m => m.type === "autocompleteApplied" && m.path === claws, "the attack applied");

        clawsTab = await firstTab(a, claws);
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            await p.expectValue(`${claws}.trait`, traitOf(natural));
            await eventually(() => p.exists(`${claws}.item`), shown => expect(shown, `${p.name}: Item row`).toBe(false));
            // 1d10, S.b 4 and X 2.
            await damage(p, clawsTab, "1d10+6");
            await damage(p, clawsTab, "0", "pen");
        }
        await b.openMods(clawsTab, "damage");
        expect(await breakdown(b, clawsTab, "damage")).toEqual(["+2 Natural Weapons (2)"]);
        expect(await modifiers(b, clawsTab, "damage")).toEqual(["S.b"]);
        await b.closeDropdowns();
    });

    it("renaming the trait to Natural Weapons (3) raises the damage without touching the attack", async () => {
        const { a, b } = t;
        await a.clearRecords();
        await renameTrait(a, natural, "Natural Weapons (3)");
        expect((await a.settledSheetMessages()).filter(m => String(m.path).startsWith(claws)), "no edit of the attack").toEqual([]);
        for (const p of [a, b]) await damage(p, clawsTab, "1d10+7");
    });

    it("a profile of Deadly Natural Weapons (3) gets Pen 3 from the trait", async () => {
        const { a, b } = t;
        deadly = await addTrait(a, "Deadly Natural Weapons (3)");
        const bite = await attackTyping(a, "cla");
        await pickSuggestion(a, "Claws (Deadly Natural Weapons) | Deadly Natural Weapons (3)", "In Traits");
        await a.waitReceived(m => m.type === "autocompleteApplied" && m.path === bite, "the attack applied");
        const tab = await firstTab(a, bite);
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            await p.expectValue(`${bite}.trait`, traitOf(deadly));
            await damage(p, tab, "1d10+7");
            await damage(p, tab, "3", "pen");
        }
        await b.openMods(tab, "pen");
        expect(await breakdown(b, tab, "pen")).toEqual(["+3 Deadly Natural Weapons (3)"]);
        await b.closeDropdowns();
        await a.openNavTab("combat");
        await a.remove(bite);
    });

    it("Natural Weapons (3, Claws) offers only Claws", async () => {
        const { a } = t;
        await renameTrait(a, natural, "Natural Weapons (3, Claws)");
        const attack = await attackTyping(a, "Natural W");
        await eventually(() => suggestions(a), s => {
            const own = s.filter(o => o.endsWith("| Natural Weapons (3, Claws)"));
            expect(own, "A: the trait's").toEqual(["Claws (Natural Weapons) / Когти | Natural Weapons (3, Claws)"]);
            // The Deadly trait names no weapon: all seven.
            expect(s.filter(o => o.endsWith("| Deadly Natural Weapons (3)")), "A: the Deadly trait's").toHaveLength(7);
        });
        await a.closeSuggestions();
        await a.openNavTab("combat");
        await a.remove(attack);
    });

    it("the Trait select's — unlinks; a deleted trait shows deleted, dimmed", async () => {
        const { a, b } = t;
        await a.openNavTab("combat");
        await (await a.el(`${claws}.trait`)).selectOption("");
        for (const p of [a, b]) await damage(p, clawsTab, "1d10+4");
        await (await a.el(`${claws}.trait`)).selectOption(traitOf(natural));
        for (const p of [a, b]) await damage(p, clawsTab, "1d10+7");

        await a.openNavTab("talents");
        await a.remove(natural);
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            await eventually(() => p.page.evaluate(path => {
                const select = window.__e2e.fields(path)[0] as HTMLSelectElement | undefined;
                return { text: select?.selectedOptions[0]?.text, dimmed: select?.classList.contains("dimmed") };
            }, `${claws}.trait`), v => expect(v, `${p.name}: the Trait select`).toEqual({ text: "deleted", dimmed: true }));
            await damage(p, clawsTab, "1d10+4");
        }
    });

    it("a Rulebook pick with a Deadly trait on the sheet puts its X in as enabled damage and Pen modifiers", async () => {
        const { a, b } = t;
        const attack = await attackTyping(a, "Claws (Dead");
        await pickSuggestion(a, "Claws (Deadly Natural Weapons)", "Rulebook");
        const apply = await a.waitSent(m => m.type === "autocompleteApply" && m.path === attack, "the apply");
        expect(apply.rating).toBe("3");
        expect(apply.base.trait ?? "", "not linked").toBe("");
        await a.waitReceived(m => m.type === "autocompleteApplied" && m.path === attack, "the attack applied");
        const tab = await firstTab(b, attack);
        await damage(b, tab, "1d10+7");
        await damage(b, tab, "3", "pen");
        await b.openMods(tab, "damage");
        expect(await modifiers(b, tab, "damage")).toEqual(["S.b", "3"]);
        await b.closeDropdowns();
        await b.openMods(tab, "pen");
        expect(await modifiers(b, tab, "pen")).toEqual(["3"]);
        await b.closeDropdowns();
        expect(await b.exists(`${attack}.trait`), "no link: the Trait row is offered").toBe(true);
        expect(await b.read(`${attack}.trait`)).toBe("");
    });

    it("a Rulebook pick without the trait on the sheet puts in X, off and outlined", async () => {
        const { a, b } = t;
        const attack = await attackTyping(a, "Claws (Natural");
        // Nothing of the sheet's matches: the rulebook's alone, without headings.
        await pickSuggestion(a, "Claws (Natural Weapons)");
        const apply = await a.waitSent(m => m.type === "autocompleteApply" && m.path === attack, "the apply");
        expect(apply.rating).toBe("X");
        await a.waitReceived(m => m.type === "autocompleteApplied" && m.path === attack, "the attack applied");
        const tab = await firstTab(b, attack);
        await damage(b, tab, "1d10+4");
        await b.openMods(tab, "damage");
        expect(await modifiers(b, tab, "damage")).toEqual(["S.b", "X off invalid"]);
        await b.closeDropdowns();
    });
});

describe("Natural Weapons on a Black Crusade sheet", () => {
    const t = useTable("natural-weapons-bc");

    it("has no In Traits group and no Trait row, though the trait is on the sheet", async () => {
        const { a, b } = t;
        await addTrait(a, "Natural Weapons (2)");
        const attack = await attackTyping(a, "cla");
        await eventually(() => suggestions(a), s => expect(s.length, "A: the rulebook's").toBeGreaterThan(0));
        expect((await suggestions(a)).filter(s => s.startsWith("# ")), "A: no headings").toEqual([]);
        await a.closeSuggestions();
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            await eventually(() => p.exists(`${attack}.name`), shown => expect(shown, `${p.name}: the attack`).toBe(true));
            expect(await p.exists(`${attack}.trait`), `${p.name}: Trait row`).toBe(false);
        }
    });
});
