// ui/static/js/sheet/state/computed.js

import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { characterState } from "./state.js";
import {
    RangedAttack, MeleeAttack, CustomSkill,
    PsychicPower, TechPower, CharacteristicBlock
} from "../elements.js";
import {
    calculateCharacteristicBase, calculateSkillAdvancement,
    calculateTestDifficulty, calculateBonusSuccesses,
} from "../system.js";
import {
    getItemVersion,
} from "./sync.js"

const num = s => Number(s?.value) || 0;
const bool = s => !!s?.value;

// ─── Carry weight tables ──────────────────────────────────────────────────────

const CARRY_WEIGHT_TABLE = [
    0.9, 2.25, 4.5, 9, 18, 27, 36, 45, 56, 67, 78, 90, 112, 225, 337, 450,
    675, 900, 1350, 1800, 2250, 2700, 3150, 3600, 4050, 4500, 4950, 5400,
    5850, 6300, 6750, 7200, 7650, 8100, 8550, 9000, 9450, 9900, 10350,
    10800, 11250, 11700, 12150, 12600, 13050, 13500,
];
const LIFT_WEIGHT_TABLE = [
    2.25, 4.5, 9, 18, 36, 54, 72, 90, 112, 135, 157, 180, 225, 450, 675, 900,
    1350, 1800, 2700, 3600, 4500, 5400, 6300, 7200, 8100, 9000, 9900, 10800,
    11700, 12600, 13500, 14400, 15300, 16200, 17100, 18000, 18900, 19800,
    20700, 21600, 22500, 23400, 24300, 25200, 26100, 27000,
];
const PUSH_WEIGHT_TABLE = [
    4.5, 9, 18, 36, 72, 108, 144, 180, 225, 270, 315, 360, 450, 900, 1350,
    1800, 2700, 3600, 5400, 7200, 9000, 10800, 12600, 14400, 16200, 18000,
    19800, 21600, 23400, 25200, 27000, 28800, 30600, 32400, 34200, 36000,
    37800, 39600, 41400, 43200, 45000, 46800, 48600, 50400, 52200, 54000,
];

// ─── Characteristic helpers (used by armourComputed below) ───────────────────
// CharacteristicBlock.attachComputeds() writes calculatedValue / calculatedUnnatural
// directly onto characterState — that's what bindings.js uses for display.
// These module-level helpers exist only so armourComputed can read them synchronously.

const charVal = key => {
    const c = characterState.characteristics?.[key];
    return num(c?.value) + (bool(c?.tempEnabled) ? num(c?.tempValue) : 0);
};
const charUnnatural = key => {
    const c = characterState.characteristics?.[key];
    return num(c?.unnatural) + (bool(c?.tempEnabled) ? num(c?.tempUnnatural) : 0);
};

// ─── Armour ───────────────────────────────────────────────────────────────────

export const armourComputed = { parts: {} };

armourComputed.toughnessBase = computed(() =>
    calculateCharacteristicBase(charVal("T"), charUnnatural("T"))
);

["head", "leftArm", "rightArm", "body", "leftLeg", "rightLeg"].forEach(part => {
    armourComputed.parts[part] = {
        sum: computed(() => {
            const p = characterState.armour?.[part];
            return num(p?.armourValue) + num(p?.extra1Value) + num(p?.extra2Value);
        }),
        total: computed(() =>
            armourComputed.toughnessBase.value
            + armourComputed.parts[part].sum.value
            + num(characterState.armour?.naturalArmourValue)
            + num(characterState.armour?.machineValue)
            + num(characterState.armour?.daemonicValue)
            + num(characterState.armour?.otherArmourValue)
        ),
        toughnessSuper: computed(() =>
            armourComputed.toughnessBase.value + num(characterState.armour?.daemonicValue)
        ),
        superArmourSub: computed(() =>
            num(characterState.armour?.[part]?.superArmour)
        ),
    };
});

armourComputed.woundsRemaining = computed(() =>
    num(characterState.armour?.woundsMax) - num(characterState.armour?.woundsCur)
);

// ─── Carry weight ─────────────────────────────────────────────────────────────

export const carryWeightComputed = {
    carryWeight: computed(() => {
        const base = num(characterState.carryWeightAndEncumbrance?.carryWeightBase);
        if (base > 45) return "too";
        if (base < 0) return "such";
        return CARRY_WEIGHT_TABLE[base];
    }),
    liftWeight: computed(() => {
        const base = num(characterState.carryWeightAndEncumbrance?.carryWeightBase);
        if (base > 45) return "strong";
        if (base < 0) return "a puny";
        return LIFT_WEIGHT_TABLE[base];
    }),
    pushWeight: computed(() => {
        const base = num(characterState.carryWeightAndEncumbrance?.carryWeightBase);
        if (base > 45) return "to hold!";
        if (base < 0) return "weakling!";
        return PUSH_WEIGHT_TABLE[base];
    }),
    encumbrance: computed(() => {
        getItemVersion('gear.items').value;
        let total = 0;
        for (const id in (characterState.gear?.items ?? {})) {
            total += num(characterState.gear.items[id]?.weight);
        }
        return total;
    }),
};

// ─── Experience ───────────────────────────────────────────────────────────────

export const experienceComputed = {
    spent: computed(() => {
        getItemVersion('experience.experienceLog.items').value;
        let total = 0;
        for (const id in (characterState.experience?.experienceLog?.items ?? {})) {
            total += num(characterState.experience.experienceLog.items[id]?.experienceCost);
        }
        return total;
    }),
    remaining: computed(() =>
        num(characterState.experience?.experienceTotal) - experienceComputed.spent.value
    ),
};

// ─── Psykana ──────────────────────────────────────────────────────────────────

export const psykanaComputed = {
    effectivePR: computed(() =>
        num(characterState.psykana?.basePR) - num(characterState.psykana?.sustainedPowers)
    ),
};

// ─── Standard skill computed ──────────────────────────────────────────────────

function attachStandardSkillComputed(skillId, mapName) {
    const sk = characterState[mapName]?.[skillId];
    if (!sk || sk.difficulty) return; // absent or already attached

    sk.difficulty = computed(() => {
        const key = sk.characteristic?.value || "WS";
        const val = charVal(key);

        let count = 0;
        if (sk.plus0?.value) count++;
        if (sk.plus10?.value) count++;
        if (sk.plus20?.value) count++;
        if (sk.plus30?.value) count++;

        return calculateTestDifficulty(val, calculateSkillAdvancement(count))
            + num(sk.miscBonus);
    });
}

// ─── Wire module-level computeds into characterState ─────────────────────────
// Doing this here (not in a separate function called later) keeps it explicit.
// Must be called after Object.assign(characterState, tree) in state.js.

function wireIntoState() {
    if (!characterState.armour) characterState.armour = {};
    characterState.armour.toughnessBaseAbsorptionValue = armourComputed.toughnessBase;
    characterState.armour.woundsRemaining = armourComputed.woundsRemaining;
    for (const part of ["head", "leftArm", "rightArm", "body", "leftLeg", "rightLeg"]) {
        if (!characterState.armour[part]) characterState.armour[part] = {};
        Object.assign(characterState.armour[part], armourComputed.parts[part]);
    }

    if (!characterState.carryWeightAndEncumbrance) characterState.carryWeightAndEncumbrance = {};
    Object.assign(characterState.carryWeightAndEncumbrance, carryWeightComputed);

    if (!characterState.experience) characterState.experience = {};
    characterState.experience.experienceSpent = experienceComputed.spent;
    characterState.experience.experienceRemaining = experienceComputed.remaining;

    if (!characterState.psykana) characterState.psykana = {};
    characterState.psykana.effectivePR = psykanaComputed.effectivePR;
}

// ─── attachComputeds ─────────────────────────────────────────────────────────

export function attachComputeds(s) {
    // Characteristics
    for (const key of Object.keys(s.characteristics ?? {})) {
        CharacteristicBlock.attachComputeds(key);
    }

    // Standard skills — tree is now built from DOM so ALL rows are present
    for (const id of Object.keys(s.skillsLeft ?? {})) {
        attachStandardSkillComputed(id, 'skillsLeft');
    }
    for (const id of Object.keys(s.skillsRight ?? {})) {
        attachStandardSkillComputed(id, 'skillsRight');
    }

    // Custom skills
    for (const id of Object.keys(s.customSkills?.items ?? {})) {
        CustomSkill.attachComputeds(id);
    }

    // Attacks
    for (const id of Object.keys(s.rangedAttacks?.items ?? {})) {
        RangedAttack.attachComputeds(id);
    }
    for (const id of Object.keys(s.meleeAttacks?.items ?? {})) {
        MeleeAttack.attachComputeds(id);
    }

    // Powers
    for (const [tabId, tab] of Object.entries(s.psykana?.tabs?.items ?? {})) {
        for (const powId of Object.keys(tab.powers?.items ?? {})) {
            PsychicPower.attachComputeds(tabId, powId);
        }
    }
    for (const [tabId, tab] of Object.entries(s.technoArcana?.tabs?.items ?? {})) {
        for (const powId of Object.keys(tab.powers?.items ?? {})) {
            TechPower.attachComputeds(tabId, powId);
        }
    }

    // Wire module-level computeds (armour totals, carry weight, XP, PR)
    // into characterState so resolvePath() can find them
    wireIntoState();
}