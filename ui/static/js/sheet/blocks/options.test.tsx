import { afterEach, expect, it } from "vitest";
import { loadState, renderBlock, type Rendered, getDataPath, testState } from "../components/testUtils";
import { specAtPath } from "../state/fromJson";
import { BlackCrusade } from "../kinds/black_crusade";
import { schemaOf } from "../state/state";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const grid = (items: { [id: string]: object }) => ({
    items,
    layouts: Object.fromEntries(Object.keys(items).map((id, i) => [id, pos(0, i)])),
});

// Items in every state that renders a select or radio group of its own.
const content = {
    conditions: { list: grid({ c1: { entries: grid({ e1: { type: "char_bonus" }, e2: { type: "bonus_ap" } }) } }) },
    gear: { list: grid({ g1: { gearType: "armour", entries: grid({ e1: { type: "bonus_ap" } }) } }) },
    cybernetics: { list: grid({ y1: { entries: grid({ e1: { type: "skill_bonus" } }) } }) },
    customSkills: { list: grid({ s1: { name: "Pilot" } }) },
    powerShields: { list: grid({ p1: { name: "Dome" } }) },
    experience: {
        experienceLog: grid({ x1: { type: "characteristic" }, x2: { type: "skill" }, x3: { type: "talent" }, x4: { type: "other" } }),
    },
    rangedAttacks: { list: grid({ r1: { roll: { testOption: "o1" } } }), testOptions: grid({ o1: { base: "BS" } }) },
    meleeAttacks: {
        list: grid({ m1: { group: "primary (shield)", roll: { testOption: "o1" }, tabs: grid({ t1: { profile: "mace" } }) } }),
        testOptions: grid({ o1: { base: "medicae", characteristic: "WS" } }),
    },
    psykana: {
        testOptions: grid({ o1: { base: "awareness", characteristic: "I" } }),
        tabs: grid({ t1: { powers: grid({ p1: { roll: { testOption: "o1" } } }) } }),
    },
    technoArcana: { tabs: grid({ t1: { powers: grid({ p1: { roll: { testOption: "gone" } } }) } }) },
};

// An advancement offers the levels of its type, a prefix of the schema's levels.
const PREFIX_OF_SCHEMA = new Set(["level"]);

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
});

it("offers in every select and radio group exactly the options the schema allows at its path", () => {
    loadState(content);
    rendered = renderBlock(<BlackCrusade />);

    const offered = new Map<string, string[]>();
    for (const el of rendered.container.querySelectorAll<HTMLSelectElement>("select[data-id]")) {
        offered.set(getDataPath(el), Array.from(el.options, o => o.value));
    }
    for (const el of rendered.container.querySelectorAll<HTMLInputElement>('input[type="radio"][data-id]')) {
        const path = getDataPath(el);
        offered.set(path, [...(offered.get(path) ?? []), el.value]);
    }
    expect(offered.size).toBeGreaterThan(40);

    const mismatches: string[] = [];
    for (const [path, values] of offered) {
        const spec = specAtPath(schemaOf(testState()), path);
        // Open selects offer what the sheet has (testOptions.test.tsx).
        if (spec?.kind === "field" && spec.control === "select" && !spec.options) continue;
        const allowed = spec?.kind === "field" ? spec.options ?? null : null;
        const field = path.split(".").at(-1)!;
        const ok = allowed !== null && (PREFIX_OF_SCHEMA.has(field)
            ? values.every((v, i) => v === allowed[i])
            : values.length === allowed.length && values.every((v, i) => v === allowed[i]));
        if (!ok) mismatches.push(`${path}: offers ${JSON.stringify(values)}, schema ${JSON.stringify(allowed)}`);
    }
    expect(mismatches).toEqual([]);
});
