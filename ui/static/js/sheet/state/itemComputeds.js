// Computed outputs of grid items: a custom skill's difficulty, the roll total
// of an attack or a power, the cost of an advancement. They are placed next
// to the item's fields, where the item renders them and the sheet computeds
// read them. createItemInState attaches them to new items.
import { computed } from "@preact/signals-core";
import { characterState } from "./state.js";
import { skillDifficulty } from "./computed.js";
import { resolvePath } from "./sync.js";
import { getRollValue } from "./rollBase.js";
import { alignmentMatches } from "../system.js";
import { EXPERIENCE_LEVELS_BY_TYPE, MELEE_ROLL_COLUMNS, RANGED_ROLL_COLUMNS, modifierField } from "../schema/constants";

const num = s => Number(s?.value) || 0;
const extra = e => (e?.enabled?.value ? num(e?.value) : 0);

function attachCustomSkill(sk) {
    sk.difficulty = computed(() => skillDifficulty(sk, sk.characteristic?.value || "WS", sk.name?.value));
}

/** The modifier of the option selected in `column` of the roll, the column's default when none or no known one is. */
function selectedModifier(roll, column) {
    const node = roll[column.key];
    const selected = node?.selected?.value || column.default;
    return num(node?.[modifierField(selected)] ?? node?.[modifierField(column.default)]);
}

/** Attaches the roll total of an attack whose dropdown has `columns`. */
const attachAttackRoll = columns => item => {
    const r = item.roll;
    if (!r) return;
    r.total = computed(() => getRollValue(r.baseSelect?.value)
        + columns.reduce((sum, column) => sum + selectedModifier(r, column), 0)
        + extra(r.extra1) + extra(r.extra2));
};

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

function attachExperienceCost(item) {
    item.computedCost = computed(() => {
        const levels = EXPERIENCE_LEVELS_BY_TYPE[item.type?.value ?? ''];
        if (!levels) return num(item.experienceCost);

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

        // A level left from another type may be above the last one.
        const raw = parseInt(item.level?.value, 10) || 1;
        return levels[Math.max(0, Math.min(levels.length - 1, raw - 1))].cost[matchCount];
    });
}

const ITEM_COMPUTEDS = [
    [/^customSkills\.list\.items$/, attachCustomSkill],
    [/^rangedAttacks\.list\.items$/, attachAttackRoll(RANGED_ROLL_COLUMNS)],
    [/^meleeAttacks\.list\.items$/, attachAttackRoll(MELEE_ROLL_COLUMNS)],
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
