// Computed outputs of grid items: a custom skill's difficulty, the roll total
// of an attack or a power, the cost of an advancement. They are placed next
// to the item's fields, where the item renders them and the sheet computeds
// read them. createItemInState attaches them to new items.
import { computed } from "@preact/signals-core";
import { characterState } from "./state.js";
import { sumEntryField } from "./computed.js";
import { resolvePath } from "./sync.js";
import { getRollValue } from "../elements/util/rollHelpers.js";
import {
    alignmentMatches, calculateSkillAdvancement, calculateTestDifficulty, normalizeSkillName,
} from "../system.js";

const num = s => Number(s?.value) || 0;
const extra = e => (e?.enabled?.value ? num(e?.value) : 0);

function attachCustomSkill(sk) {
    sk.difficulty = computed(() => {
        const charKey = sk.characteristic?.value || "WS";
        const char = characterState.characteristics?.[charKey];
        const val = char?.valueForRolls?.value
            ?? ((parseInt(char?.value?.value, 10) || 0)
                + ((char?.tempEnabled?.value ?? false)
                    ? (parseInt(char?.tempValue?.value, 10) || 0) : 0));

        let count = 0;
        if (sk.plus0?.value) count++;
        if (sk.plus10?.value) count++;
        if (sk.plus20?.value) count++;
        if (sk.plus30?.value) count++;

        const skillName = normalizeSkillName(sk.name?.value ?? '');
        const skillCondBonus = skillName
            ? sumEntryField('skill_bonus', 'skillBonus',
                e => normalizeSkillName(e.name?.value) === skillName)
            : 0;

        return calculateTestDifficulty(val, calculateSkillAdvancement(count))
            + num(sk.miscBonus)
            + skillCondBonus;
    });
}

/** The modifier of the selected option of a roll column such as aim or range. */
function selectedModifier(column, fallback) {
    const selected = column?.selected?.value || fallback;
    return num(column?.[selected] ?? column?.[fallback]);
}

function attachRangedRoll(item) {
    const r = item.roll;
    if (!r) return;
    r.total = computed(() => getRollValue(r.baseSelect?.value)
        + selectedModifier(r.aim, "no")
        + selectedModifier(r.target, "no")
        + selectedModifier(r.range, "combat")
        + selectedModifier(r.rof, "single")
        + extra(r.extra1) + extra(r.extra2));
}

function attachMeleeRoll(item) {
    const r = item.roll;
    if (!r) return;
    r.total = computed(() => getRollValue(r.baseSelect?.value)
        + selectedModifier(r.aim, "no")
        + selectedModifier(r.target, "no")
        + selectedModifier(r.base, "standard")
        + selectedModifier(r.stance, "standard")
        + selectedModifier(r.rof, "single")
        + extra(r.extra1) + extra(r.extra2));
}

function attachPsychicRoll(item) {
    const r = item.roll;
    if (!r) return;
    r.total = computed(() => getRollValue(r.baseSelect?.value)
        + num(r.modifier)
        + num(r.effectivePR) * 5
        + num(r.kickPR) * 5
        + extra(r.extra1) + extra(r.extra2));
}

function attachTechRoll(item) {
    const r = item.roll;
    if (!r) return;
    r.total = computed(() => getRollValue(r.baseSelect?.value)
        + num(r.modifier)
        + extra(r.extra1) + extra(r.extra2));
}

// Advancement types that derive cost from aptitudes + character state.
// All others use the stored experienceCost directly.
export const CALC_EXPERIENCE_TYPES = new Set(['characteristic', 'skill', 'talent']);

// Black Crusade cost tables indexed by [type][aptMatch 0-2][levelIdx]
const EXPERIENCE_COSTS = {
    characteristic: {
        2: [100, 250, 500, 750, 1000],
        1: [250, 500, 750, 1000, 1500],
        0: [500, 750, 1000, 1500, 2500],
    },
    talent: {
        2: [150, 300, 400],
        1: [250, 500, 750],
        0: [400, 750, 1000],
    },
    skill: {
        2: [100, 200, 350, 550],
        1: [200, 350, 500, 750],
        0: [300, 500, 700, 900],
    },
};

function attachExperienceCost(item) {
    item.computedCost = computed(() => {
        const type = item.type?.value ?? '';
        if (!CALC_EXPERIENCE_TYPES.has(type)) return num(item.experienceCost);

        const experience = characterState.experience;
        const useApt = !!experience?.useAptitudes?.value;
        const useDev = !!experience?.useDevotion?.value;

        // Start at neutral (1 match) when no toggles are active
        let matchCount = 1;

        if (useApt) {
            const itemApts = (item.aptitudes?.value ?? '')
                .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const charApts = (experience?.aptitudes?.value ?? '')
                .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            if (!charApts.includes('gen')) charApts.push('gen');
            matchCount = Math.min(2, itemApts.filter(a => charApts.includes(a)).length);
        }

        if (useDev) {
            const charAlignment = experience?.alignment?.value ?? '';
            if (charAlignment && charAlignment.toLowerCase() !== 'undivided') {
                if (alignmentMatches(charAlignment, item.alliedTo?.value)) {
                    matchCount = Math.min(2, matchCount + 1);
                } else if (alignmentMatches(charAlignment, item.hostileTo?.value)) {
                    matchCount = Math.max(0, matchCount - 1);
                }
            }
        }

        const table = EXPERIENCE_COSTS[type]?.[matchCount];
        if (!table) return null;

        const raw = parseInt(item.level?.value, 10) || 1;
        const levelIdx = type === 'characteristic'
            ? Math.max(0, Math.min(4, raw - 1))
            : type === 'skill'
                ? Math.max(0, Math.min(3, raw - 1))
                : Math.max(0, Math.min(2, raw - 1));

        return table[levelIdx] ?? null;
    });
}

const ITEM_COMPUTEDS = [
    [/^customSkills\.list\.items$/, attachCustomSkill],
    [/^rangedAttacks\.list\.items$/, attachRangedRoll],
    [/^meleeAttacks\.list\.items$/, attachMeleeRoll],
    [/^psykana\.tabs\.items\.[^.]+\.powers\.items$/, attachPsychicRoll],
    [/^technoArcana\.tabs\.items\.[^.]+\.powers\.items$/, attachTechRoll],
    [/^experience\.experienceLog\.items$/, attachExperienceCost],
];

/** Attaches the computed outputs of the item `itemId` of the grid at `gridPath`, if it has any. */
export function attachItemComputeds(gridPath, itemId) {
    const entry = ITEM_COMPUTEDS.find(([pattern]) => pattern.test(gridPath));
    if (!entry) return;
    const item = resolvePath(`${gridPath}.${itemId}`);
    if (item && typeof item === 'object') entry[1](item);
}

/** Attaches the computed outputs of every item of the sheet. */
export function attachAllItemComputeds(s) {
    const grids = [
        ['customSkills.list.items', s.customSkills?.list?.items],
        ['rangedAttacks.list.items', s.rangedAttacks?.list?.items],
        ['meleeAttacks.list.items', s.meleeAttacks?.list?.items],
        ['experience.experienceLog.items', s.experience?.experienceLog?.items],
    ];
    for (const [tabId, tab] of Object.entries(s.psykana?.tabs?.items ?? {})) {
        grids.push([`psykana.tabs.items.${tabId}.powers.items`, tab.powers?.items]);
    }
    for (const [tabId, tab] of Object.entries(s.technoArcana?.tabs?.items ?? {})) {
        grids.push([`technoArcana.tabs.items.${tabId}.powers.items`, tab.powers?.items]);
    }
    for (const [gridPath, items] of grids) {
        for (const id of Object.keys(items ?? {})) attachItemComputeds(gridPath, id);
    }
}
