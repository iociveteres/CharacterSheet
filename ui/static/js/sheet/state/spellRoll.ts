// The roll a spell picked from the autocomplete gets from its Magic test: the
// gamedata gives the test as text, the sheet reads it once, at the pick
// (_prd/pathfinder_gamedata/spells.md). Later edits of the Test field leave
// the roll as it is.
import { nanoid } from "nanoid";
import { createAtEnd } from "../components/columns";
import type { SheetActions } from "./actions";
import { CS, magicTestChoices, parseMagicTest, testSkills, type TestAlternative } from "./magicTest";
import { findSkill } from "./rollBase";
import { hasSpellcasting } from "./spellcasting";
import { statsOf } from "./state";
import { CAST, isCharacteristic, testOptionsOf } from "./testOptions";
import type { StatSet } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";

export interface NewTestOption {
    id: string;
    base: string;
    characteristic: string;
}

export interface SpellRoll {
    /** The fields of the roll the test sets; none for a test it cannot read. */
    roll: { testOption?: string; modifier?: number; skill?: string; characteristic?: string };
    /** A Magic test option to add for the roll, the one its testOption names. */
    option?: NewTestOption;
}

/** The characteristic the skill `base` of the sheet is tested on by itself. */
function ownCharacteristic(state: SheetSignals, stats: StatSet, base: string): string {
    const row = [...stats.skillsLeft, ...stats.skillsRight].find(r => r.key === base);
    return findSkill(state, base)?.skill.characteristic?.value || row?.def || "";
}

/**
 * The test option `alternative` is cast on, as an option of the Magic test
 * would name it; null for one the sheet cannot have: Cs without
 * Spellcasting, a characteristic of another kind, a skill not on the sheet.
 */
function optionTest(state: SheetSignals, stats: StatSet, alternative: TestAlternative): { base: string; characteristic: string } | null {
    if (!alternative.skill) {
        const characteristic = alternative.characteristics[0];
        if (characteristic === CS) return hasSpellcasting(state) ? { base: CAST, characteristic: "" } : null;
        return isCharacteristic(stats, characteristic) ? { base: characteristic, characteristic: "" } : null;
    }
    const base = testSkills(state, stats, alternative)[0];
    if (base === undefined) return null;
    const characteristic = alternative.characteristics[0] ?? "";
    return { base, characteristic: characteristic === ownCharacteristic(state, stats, base) ? "" : characteristic };
}

/**
 * The roll of a spell with the Magic test `test`. A PR spell is tested on the
 * first Magic test option the first alternative names, Cs on Cast, a new one
 * when the sheet has none such; on the first option as before when the sheet
 * cannot have it. An Arts spell is tested on the first skill of the sheet its
 * test names, as its button in ArtsRoll.tsx sets it. A modifier that is no
 * single number is 0: the roll shows the test beside it.
 */
export function spellRollFromTest(state: SheetSignals, test: string, arts: boolean): SpellRoll {
    if (arts) {
        const choice = magicTestChoices(state, test).choices[0];
        return { roll: choice ? { skill: choice.skill, characteristic: choice.characteristic, modifier: choice.modifier ?? 0 } : {} };
    }
    const stats = statsOf(state);
    const alternative = parseMagicTest(test, stats)[0];
    if (!alternative) return { roll: {} };
    const modifier = alternative.modifier ?? 0;
    const wanted = optionTest(state, stats, alternative);
    if (!wanted) return { roll: { modifier } };

    // A characteristic and Cast are matched by their base: an option's characteristic does not change what it tests.
    const bySkill = wanted.base !== CAST && !isCharacteristic(stats, wanted.base);
    const own = bySkill ? ownCharacteristic(state, stats, wanted.base) : "";
    const found = testOptionsOf(state, "psykana").find(([, o]) => {
        if (o.base.peek() !== wanted.base) return false;
        const characteristic = o.characteristic.peek();
        return !bySkill || (characteristic === own ? "" : characteristic) === wanted.characteristic;
    });
    if (found) return { roll: { testOption: found[0], modifier } };
    const option = { id: `test-option-${nanoid()}`, ...wanted };
    return { roll: { testOption: option.id, modifier }, option };
}

/** Adds `option` at the end of the Magic test options. */
export function addTestOption(state: SheetSignals, actions: SheetActions, { id, base, characteristic }: NewTestOption): void {
    const ids = testOptionsOf(state, "psykana").map(([optionId]) => optionId);
    createAtEnd(actions, "psykana.testOptions.items", [ids], 0, id, { base, characteristic });
}
