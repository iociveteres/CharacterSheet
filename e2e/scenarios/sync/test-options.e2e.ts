// The Test Options of psykana and techno arcana: a new sheet starts with the
// options the power selects had, and a power follows the option it is tested
// on, on both players' screens.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";

const selectOptions = (p: Player, selectPath: string) =>
    p.page.evaluate(path => Array.from((window.__e2e.fields(path)[0] as HTMLSelectElement).options, o => [o.value, o.text]), selectPath);

describe("test options", () => {
    const t = useTable("test options");
    let power = "";

    beforeAll(async () => {
        const { a } = t;
        await a.openNavTab("player");
        await a.write("characteristics.W.value", "40");
        await a.write("characteristics.WS.value", "30");
        power = await addItem(t.a, await showGrid(t.a, grid("psychicPowers")));
    });

    it("a new sheet offers the tests the power selects had, and a new power the first of them", async () => {
        const { a } = t;
        const options = async (block: "psykana" | "technoArcana") => {
            await a.openTestOptions(block);
            const ids = (await a.layout(`${block}.testOptions.items`)).flat();
            return Promise.all(ids.map(async id => [
                id,
                await a.read(`${block}.testOptions.items.${id}.base`),
                await a.read(`${block}.testOptions.items.${id}.characteristic`),
            ]));
        };
        expect(await options("psykana")).toEqual([
            ["test-option-1", "W", ""], ["test-option-2", "P", ""], ["test-option-3", "psyniscience", ""],
            ["test-option-4", "logic", ""], ["test-option-5", "Cor", ""],
        ]);
        expect(await options("technoArcana")).toEqual([
            ["test-option-1", "tech-use", ""], ["test-option-2", "medicae", ""], ["test-option-3", "awareness", "I"],
            ["test-option-4", "athletics", ""], ["test-option-5", "logic", ""],
        ]);
        await a.openRoll(power);
        expect(await a.read(`${power}.roll.testOption`)).toBe("test-option-1");
    });

    it("a power follows the edits of its test option on both screens, and survives a reload", async () => {
        const { a, b } = t;
        await a.openNavTab("psykana");
        await a.openTestOptions("psykana");
        const option = await addItem(a, "psykana.testOptions.items");
        const optionId = option.split(".").at(-1)!;
        await a.write(`${option}.base`, "W");
        await b.openTestOptions("psykana");
        await b.expectValue(`${option}.base`, "W");

        // Each dropdown renders its fields only while open, and opening one closes the other.
        const testOption = `${power}.roll.testOption`;
        await Promise.all([a.openRoll(power), b.openRoll(power)]);
        expect((await selectOptions(a, testOption)).at(-1)).toEqual([optionId, "W"]);
        await a.write(testOption, optionId);
        await b.expectValue(testOption, optionId);
        await b.expectValue(`${power}.roll.total`, "40");

        await a.openTestOptions("psykana");
        await a.write(`${option}.base`, "WS");
        await b.expectValue(`${power}.roll.total`, "30");
        expect((await selectOptions(b, testOption)).find(([id]) => id === optionId)).toEqual([optionId, "WS"]);

        await a.reload();
        await a.openRoll(power);
        expect(await a.read(testOption)).toBe(optionId);
        expect(await a.read(`${power}.roll.total`)).toBe("30");
    });

    it("a power whose test option is deleted has no test", async () => {
        const { a, b } = t;
        await a.openNavTab("psykana");
        await a.openTestOptions("psykana");
        const ids = (await a.layout("psykana.testOptions.items")).flat();
        const option = `psykana.testOptions.items.${ids.at(-1)}`;
        await a.remove(option);

        const testOption = `${power}.roll.testOption`;
        await b.openRoll(power);
        await b.expectValue(`${power}.roll.total`, "0");
        expect((await selectOptions(b, testOption))[0]).toEqual([ids.at(-1), "(test deleted)"]);
        expect(await b.page.evaluate(path => (window.__e2e.find({ path }) as HTMLButtonElement).disabled, `${power}.roll.rollButton`)).toBe(true);
    });
});
