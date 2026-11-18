import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import { installDictionary } from "../i18n/testDictionary";
import { code, label, MOD, NAME, SPACE, WRAP } from "./rollLabel";
import { hasCodes, labelText, parseLabel } from "./rollLabelText";

// The examples the server checks too (TestValidLabelExamples in internal/roomws/rolllabel_test.go).
const examples: { why: string; valid: boolean; label: unknown }[] =
    JSON.parse(readFileSync("internal/roomws/testdata/roll_labels.json", "utf8"));

describe("a stored label", () => {
    it.each(examples.map(e => [e.why, e]))("%s: read as the server checks it", (_, e) => {
        expect(parseLabel(e.label) !== null).toBe(e.valid);
        expect(parseLabel(JSON.stringify(e.label)) !== null).toBe(e.valid);
    });
});

describe("the words of a label", () => {
    const initiative = label(code(SPACE.name, NAME.initiative));

    it("are in the reader's language", () => {
        for (const lang of ["en", "ru"] as const) {
            installDictionary(lang);
            expect(labelText(initiative)).toBe(t("sheet.terms.stat.initiative"));
        }
    });

    it("put the tags in brackets after the name and the modifiers after them", () => {
        expect(labelText(label("Sword", { t: ["Mh", "2h"], m: ["charge", "head"] }))).toBe("Sword (Mh, 2h), charge, head");
        expect(labelText(label("Sword", { m: ["charge"] }))).toBe("Sword, charge");
        expect(labelText(label("Sword"))).toBe("Sword");
    });

    it("show a code the reader's registry doesn't know by its value", () => {
        expect(labelText(label("Lasgun", { m: [["aim:fullAim"], ["nosuch"]] }))).toBe("Lasgun, fullAim, nosuch");
    });

    it("fill a phrase with the parameters of its code", () => {
        installDictionary("ru");
        expect(labelText(label(code(SPACE.mod, MOD.effectivePR, { pr: 3 })))).toBe(t("sheet.magic.roll.effectivePR", { pr: 3 }));
    });

    it("name what the sheet kind calls it", () => {
        const power = code(SPACE.name, NAME.unknownPower);
        expect(labelText(label(power, { k: "pathfinder_crusade" }))).toBe(t("sheet.magicPf.psykana.unknownPower"));
        expect(labelText(label(power))).toBe(t("sheet.magic.psykana.unknownPower"));
    });

    it("go into the wrapper whole", () => {
        expect(labelText(label("Sword", { m: ["charge"], w: WRAP.broken }))).toBe(t("sheet.weapons.link.brokenRoll", { label: "Sword, charge" }));
    });
});

describe("a label", () => {
    it("has codes when a part or its wrapper is worded by the reader", () => {
        expect(hasCodes(label("Lasgun", { m: ["Scope"] }))).toBe(false);
        expect(hasCodes(label("Lasgun", { m: [code("aim", "full")] }))).toBe(true);
        expect(hasCodes(label("Lasgun", { w: WRAP.broken }))).toBe(true);
    });

    it("leaves out empty lists and the default sheet kind", () => {
        expect(label("Lasgun", { t: [], m: [], k: "black_crusade" })).toEqual({ n: "Lasgun" });
        expect(code("hit", null, { n: 10 })).toEqual(["hit", { n: 10 }]);
    });
});
