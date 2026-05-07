// ui/static/js/sheet/state/computed.js

import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { characterState } from "./state.js";
import { CharacteristicBlock } from "../elements/characteristics.js";
import { TechPower } from "../elements/tech.js";
import { CustomSkill } from "../elements/skills.js";
import { PsychicPower } from "../elements/psychic.js";
import { ExperienceItem } from "../elements/experience.js";
import { MeleeAttack } from "../elements/meleeAttack.js";
import { RangedAttack } from "../elements/rangedAttack.js";
import {
    calculateCharacteristicBase,
    calculateSkillAdvancement,
    calculateTestDifficulty,
    calculateBonusSuccesses
} from "../system.js";
import { getItemVersion } from "./sync.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const num = s => Number(s?.value) || 0;
const bool = s => !!s?.value;

// Read characteristic directly from characterState (used inside computed closures).
// CharacteristicBlock.attachComputeds() also writes calculatedValue / calculatedUnnatural
// onto characterState — bindings.js uses those for display.
const charVal = key => {
    const c = characterState.characteristics?.[key];
    return num(c?.value) + (bool(c?.tempEnabled) ? num(c?.tempValue) : 0);
};
const charUnnatural = key => {
    const c = characterState.characteristics?.[key];
    return num(c?.unnatural) + (bool(c?.tempEnabled) ? num(c?.tempUnnatural) : 0);
};

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

// ─── Module-level computed refs ───────────────────────────────────────────────
// Declared as `let` so wireIntoState() can replace them with fresh computed()
// instances on every sheet load. Creating them at module scope would lock the
// closures onto the first sheet's signals, causing stale values on sheet switch.

export let armourComputed = { parts: {} };
export let carryWeightComputed = {};
export let experienceComputed = {};
export let psykanaComputed = {};

// ─── Computed factories ───────────────────────────────────────────────────────

function buildArmourComputed() {
    const c = { parts: {} };

    c.toughnessBase = computed(() =>
        calculateCharacteristicBase(charVal("T"), charUnnatural("T"))
    );

    for (const part of ["head", "leftArm", "rightArm", "body", "leftLeg", "rightLeg"]) {
        c.parts[part] = {
            sum: computed(() => {
                const p = characterState.armour?.[part];
                return num(p?.armourValue) + num(p?.extra1Value) + num(p?.extra2Value);
            }),
            total: computed(() =>
                c.parts[part].sum.value
                + c.toughnessBase.value
                + num(characterState.armour?.naturalArmourValue)
                + num(characterState.armour?.machineValue)
                + num(characterState.armour?.daemonicValue)
                + num(characterState.armour?.otherArmourValue)
            ),
            toughnessSuper: computed(() =>
                c.toughnessBase.value + num(characterState.armour?.daemonicValue)
            ),
            superArmourSub: computed(() =>
                num(characterState.armour?.[part]?.superArmour)
            ),
        };
    }

    c.woundsRemaining = computed(() =>
        num(characterState.armour?.woundsMax) - num(characterState.armour?.woundsCur)
    );

    return c;
}

function buildCarryWeightComputed() {
    const base = () => num(characterState.carryWeightAndEncumbrance?.carryWeightBase);
    return {
        carryWeight: computed(() => {
            const b = base();
            if (b > 45) return "too";
            if (b < 0) return "such";
            return CARRY_WEIGHT_TABLE[b];
        }),
        liftWeight: computed(() => {
            const b = base();
            if (b > 45) return "strong";
            if (b < 0) return "a puny";
            return LIFT_WEIGHT_TABLE[b];
        }),
        pushWeight: computed(() => {
            const b = base();
            if (b > 45) return "to hold!";
            if (b < 0) return "weakling!";
            return PUSH_WEIGHT_TABLE[b];
        }),
        encumbrance: computed(() => {
            getItemVersion('gear.list.items').value;
            let total = 0;
            for (const id in (characterState.gear?.list?.items ?? {})) {
                total += Math.round(num(characterState.gear.list.items[id]?.weight) * 1000);
            }
            return total / 1000;
        }),
    };
}

function buildExperienceComputed() {
    const spent = computed(() => {
        getItemVersion('experience.experienceLog.items').value;
        let total = 0;
        for (const id in (characterState.experience?.experienceLog?.items ?? {})) {
            total += num(characterState.experience.experienceLog.items[id]?.computedCost);
        }
        return total;
    });
    return {
        spent,
        remaining: computed(() =>
            num(characterState.experience?.experienceTotal) - spent.value
        ),
    };
}

function buildPsykanaComputed() {
    return {
        effectivePR: computed(() =>
            num(characterState.psykana?.basePR) - num(characterState.psykana?.sustainedPowers)
        ),
    };
}

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

// ─── wireIntoState ────────────────────────────────────────────────────────────
// Rebuilds all module-level computeds from fresh signal instances, then assigns
// them onto characterState so resolvePath() and bindings.js can find them.
// Called at the end of attachComputeds() on every sheet load.

function wireIntoState() {
    armourComputed = buildArmourComputed();
    carryWeightComputed = buildCarryWeightComputed();
    experienceComputed = buildExperienceComputed();
    psykanaComputed = buildPsykanaComputed();

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

    // Standard skills — tree is built from DOM so all rows are present
    for (const id of Object.keys(s.skillsLeft ?? {})) attachStandardSkillComputed(id, 'skillsLeft');
    for (const id of Object.keys(s.skillsRight ?? {})) attachStandardSkillComputed(id, 'skillsRight');

    // Custom skills
    for (const id of Object.keys(s.customSkills?.list?.items ?? {})) {
        CustomSkill.attachComputeds(id);
    }

    // Attacks
    for (const id of Object.keys(s.rangedAttacks?.list?.items ?? {})) RangedAttack.attachComputeds(id);
    for (const id of Object.keys(s.meleeAttacks?.list?.items ?? {})) MeleeAttack.attachComputeds(id);

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

    // Experience items — attach computedCost signals.
    // experienceCost remains the editable stored field; computedCost is display-only.
    for (const id of Object.keys(s.experience?.experienceLog?.items ?? {})) {
        ExperienceItem.attachComputeds(id);
    }
    
    // Rebuild and wire module-level computeds (armour, carry weight, XP, PR)
    wireIntoState();
}