// The codes of roll labels are stored data (room_messages.label_data), so
// rollLabelCodes.golden.json keeps every code the sheet can put into a label
// or ever did. A code must stay worded in every language, through an alias
// once renamed (rollLabelText.ts ALIASES); a new one is added to the file by
// `npm run gen:roll-codes`, which runs this file with UPDATE_ROLL_CODES=1.
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDictionary } from "../i18n/testDictionary";
import type { Lang } from "../i18n";

const FILE = "ui/static/js/sheet/rollLabelCodes.golden.json";

/** The codes of every kind, the codes of one kind (its characteristics and skills) and the wrappers of a label. */
interface Golden {
    any: string[];
    black_crusade: string[];
    pathfinder_crusade: string[];
    wrappers: string[];
}

const golden: Golden = JSON.parse(readFileSync(FILE, "utf8"));
const KINDS = ["black_crusade", "pathfinder_crusade"] as const;

// Parameters for any code that takes them: what they are does not matter, only that the code is worded.
const PARAMS = { s: "Source", i: "Item", n: 10, pr: 3, kick: 1 };

/** The modules in `lang`: the sheet's tables take their words when they load. */
async function load(lang: Lang) {
    installDictionary(lang);
    vi.resetModules();
    const [registry, labels, constants, grips, stances] = await Promise.all([
        import("./rollLabelText"), import("./rollLabel"), import("./schema/constants"),
        import("./weapons/gripRules"), import("./weapons/stanceRules"),
    ]);
    return { registry, labels, constants, grips, stances };
}

afterEach(() => vi.resetModules());

/** The codes the sheet's tables give, as the golden file sorts them. */
async function derivable(): Promise<Golden> {
    const { labels: { MOD, NAME, SPACE, SRC, WRAP }, constants, grips, stances } = await load("en");
    const { MELEE_PROFILES, MELEE_ROLL_COLUMNS, QUALITIES, RANGED_ROLL_COLUMNS, columnCode, optionValue } = constants;
    const columns = [...RANGED_ROLL_COLUMNS, ...MELEE_ROLL_COLUMNS].flatMap(column =>
        column.options.map(optionValue).filter(value => value !== column.default).map(value => `${columnCode(column)}:${value}`));
    const any = [
        ...columns,
        // A combined grip is worded key by key, so the keys alone stand for every combination.
        ...grips.GRIP_KEYS.map(key => `${SPACE.grip}:${key}`),
        ...stances.STANCES.filter(s => s.key !== "standard").map(s => `${SPACE.stance}:${s.key}`),
        ...stances.STANCES.map(s => `${SPACE.src}:${SRC.stance}.${s.key}`),
        `${SPACE.src}:${SRC.condition}`, `${SPACE.src}:${SRC.item}`,
        ...MELEE_PROFILES.map(optionValue).filter(value => value && value !== "no").map(value => `${SPACE.profile}:${value}`),
        ...QUALITIES.map(optionValue).filter(value => value !== "Common").map(value => `${SPACE.quality}:${value}`),
        ...Object.values(NAME).map(value => `${SPACE.name}:${value}`),
        ...Object.values(MOD).map(value => `${SPACE.mod}:${value}`),
        SPACE.hit, SPACE.linked,
    ];
    // The characteristics and skills of each kind (char, skill, skillGroup) come with the rolls that use them.
    return { any: sorted(any), black_crusade: [], pathfinder_crusade: [], wrappers: sorted(Object.values(WRAP)) };
}

const sorted = (codes: Iterable<string>) => [...new Set(codes)].sort();

describe("the golden file of roll label codes", () => {
    it("has every code the sheet's tables give", async () => {
        const derived = await derivable();
        const keys = Object.keys(derived) as (keyof Golden)[];
        if (process.env.UPDATE_ROLL_CODES) {
            // The file only grows: a code once stored stays in it.
            const next = Object.fromEntries(keys.map(key => [key, sorted([...(golden[key] ?? []), ...derived[key]])]));
            writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
            return;
        }
        for (const key of keys) {
            const missing = derived[key].filter(code => !golden[key]?.includes(code));
            expect(missing, `run npm run gen:roll-codes to add the new codes of "${key}"`).toEqual([]);
        }
    });

    it.each(["en", "ru"] as const)("has words for every code in %s, not its value", async lang => {
        const { registry: { codeWords, labelText }, labels: { label } } = await load(lang);
        const unworded = (codes: string[], kinds: readonly string[]) =>
            codes.flatMap(code => kinds.filter(kind => codeWords(code, PARAMS, kind) === null).map(kind => `${code} (${kind})`));
        expect(unworded(golden.any, KINDS)).toEqual([]);
        for (const kind of KINDS) expect(unworded(golden[kind], [kind])).toEqual([]);
        expect(golden.wrappers.filter(w => labelText(label("Text", { w })) === "Text")).toEqual([]);
    });
});
