// The movement modes (blocks/Combat.tsx): a mode added under the ⚙ of the
// Movement heading, its SPD picked from the suggestions, shows its distances
// in the table for the other player too and survives a reload.
import { describe, expect, it } from "vitest";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("movement modes", () => {
    const t = useTable("movement");

    it("a new sheet moves by A.b+Size", async () => {
        await t.a.openNavTab("player");
        await t.a.write("characteristics.A.value", "35");
        for (const p of [t.a, t.b]) {
            await p.openNavTab("combat");
            await p.expectValue("movement.modes.items.mode-1.half", "3");
            await p.expectValue("movement.modes.items.mode-1.run", "18");
        }
    });

    it("a mode added under ⚙ with an SPD from the suggestions shows in the table for both players", async () => {
        const { a, b } = t;
        await a.openNavTab("player");
        await a.write("characteristics.S.value", "42");
        await a.openMovementModes();
        const created = await a.add("movement.modes.items");
        const mode = `movement.modes.items.${created.itemId}`;

        // Add puts the caret into the name of the new mode.
        await eventually(() => a.page.evaluate(() => {
            const active = window.__e2e.root().activeElement;
            return active ? window.__e2e.pathOf(active) : null;
        }), path => expect(path, "the focus").toBe(`${mode}.name`));
        await a.page.keyboard.type("Swim");

        await a.click(`${mode}.spd`);
        await a.page.keyboard.type("½S");
        await eventually(async () => (await a.el({ sel: ".movement-dropdown .autocomplete-option", nth: 0 })).evaluate(el => el.textContent),
            text => expect(text, "the first suggestion").toBe("½S.b — Strength bonus = 2"));
        await a.click({ sel: ".movement-dropdown .autocomplete-option", nth: 0 });
        await a.expectValue(`${mode}.spd`, "½S.b");

        // ½ × S.b 4, the rules' multipliers 1, 2, 3 and 6.
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            await p.expectValue(`${mode}.half`, "2");
            await p.expectValue(`${mode}.run`, "12");
        }
        await b.openMovementModes();
        await b.expectValue(`${mode}.name`, "Swim");

        await a.reload();
        await a.openNavTab("combat");
        await a.expectValue(`${mode}.charge`, "6");
    });
});
