// ui/static/js/sheet/state/computed.js

import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { characterState } from "./state.js";
import { CharacteristicBlock } from "../elements/characteristics.js";
import { TechPower, attachCompensationComputed } from "../elements/tech.js";
import { CustomSkill } from "../elements/skills.js";
import { PsychicPower } from "../elements/psychic.js";
import { ExperienceItem } from "../elements/experience.js";
import { MeleeAttack } from "../elements/meleeAttack.js";
import { RangedAttack } from "../elements/rangedAttack.js";
import {
    calculateCharacteristicBase,
    calculateSkillAdvancement,
    calculateTestDifficulty,
    calculateBonusSuccesses,
    parseDefenseSectors,
    resolveStackExpr,
    normalizeSkillName,
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

/**
 * Single-pass index over all entry sources.
 * Shape: Map<entryType, Map<nameUpperCase, [{entry, stacks, source}]>>
 * Built once as a shared computed so all consumers (11 characteristics,
 * skills, initiative, etc.) share one iteration instead of each doing their own.
 */
function buildEntryIndex() {
    getItemVersion('conditions.list.items').value;
    getItemVersion('gear.list.items').value;
    getItemVersion('cybernetics.list.items').value;

    const index = new Map();

    const bucket = (type, name) => {
        let byType = index.get(type);
        if (!byType) { byType = new Map(); index.set(type, byType); }
        const key = (name ?? '').toUpperCase();
        let byName = byType.get(key);
        if (!byName) { byName = []; byType.set(key, byName); }
        return byName;
    };

    for (const cond of Object.values(characterState.conditions?.list?.items ?? {})) {
        if (!cond.enabled?.value) continue;
        const stacks = parseInt(cond.stacks?.value, 10) || 1;
        for (const entry of Object.values(cond.entries?.items ?? {})) {
            const type = entry.type?.value;
            if (type) bucket(type, entry.name?.value ?? '').push({ entry, stacks, source: cond });
        }
    }

    for (const item of Object.values(characterState.gear?.list?.items ?? {})) {
        if (!item.equipped?.value) continue;
        for (const entry of Object.values(item.entries?.items ?? {})) {
            const type = entry.type?.value;
            if (type) bucket(type, entry.name?.value ?? '').push({ entry, stacks: 1, source: item });
        }
    }

    for (const item of Object.values(characterState.cybernetics?.list?.items ?? {})) {
        for (const entry of Object.values(item.entries?.items ?? {})) {
            const type = entry.type?.value;
            if (type) bucket(type, entry.name?.value ?? '').push({ entry, stacks: 1, source: item });
        }
    }

    return index;
}

/**
 * All entries of a given type, optionally filtered.
 * Flattens all name buckets — use collectEntriesByName when filtering by name.
 */
export function collectEntries(entryType, filter = null) {
    const byName = characterState._entryIndex?.value?.get(entryType);
    if (!byName) return [];
    const all = Array.from(byName.values()).flat();
    return filter ? all.filter(({ entry }) => filter(entry)) : all;
}

/**
 * Entries of a given type matching an exact name (case-insensitive).
 * O(1) index lookup — preferred for characteristic/skill lookups.
 */
export function collectEntriesByName(entryType, name) {
    return characterState._entryIndex?.value
        ?.get(entryType)?.get(name.toUpperCase()) ?? [];
}

/**
 * Sum a single numeric entry field across all matching entries.
 */
export function sumEntryField(entryType, field, filter = null) {
    return collectEntries(entryType, filter)
        .reduce((acc, { entry, stacks }) =>
            acc + resolveStackExpr(entry[field]?.value, stacks), 0);
}

/**
 * Sum a single numeric entry field for entries matching an exact name.
 */
export function sumEntryFieldByName(entryType, field, name) {
    return collectEntriesByName(entryType, name)
        .reduce((acc, { entry, stacks }) =>
            acc + resolveStackExpr(entry[field]?.value, stacks), 0);
}


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

export let movementComputed = {};
export let initiativeBonusComputed = {};
export let armourComputed = { parts: {} };
export let carryWeightComputed = {};
export let experienceComputed = {};
export let psykanaComputed = {};

// ─── Computed factories ───────────────────────────────────────────────────────

function buildMovementComputed() {
    const conditionBonus = computed(() => sumEntryField('movement_bonus', 'movementBonus'));

    function halfBase() {
        const ab = calculateCharacteristicBase(
            characterState.characteristics?.A?.calculatedValue?.value ?? 0,
            characterState.characteristics?.A?.calculatedUnnatural?.value ?? 0
        );
        return ab + num(characterState.size) + num(characterState.movement?.bonus) + conditionBonus.value;
    }

    return {
        conditionBonus,
        moveHalf: computed(() => Math.max(0, halfBase())),
        moveFull: computed(() => Math.max(0, halfBase() * (num(characterState.movement?.fullMult) || 2))),
        moveCharge: computed(() => Math.max(0, halfBase() * (num(characterState.movement?.chargeMult) || 3))),
        moveRun: computed(() => Math.max(0, halfBase() * (num(characterState.movement?.runMult) || 6))),
    };
}


function buildInitiativeBonusComputed() {
    return {
        total: computed(() => sumEntryField('initiative_bonus', 'initiativeBonus')),
    };
}

export function shieldApForPart(shield, group, part) {
    if (group !== 'primary (shield)') return null;
    if (!shield.equipped?.value) return null;

    const ap = Number(shield.ap?.value) || 0;
    const arm = shield.arm?.value ?? 'left';
    const defensive = shield.defensive?.value ?? false;

    const { alwaysParts, defensiveParts } = parseDefenseSectors(shield.defenseSectors?.value, arm);

    if (alwaysParts.has(part)) return ap;
    if (defensive && defensiveParts.has(part)) return ap;
    return null;
}

/**
 * Get AP contribution of a gear armour for a specific body part.
 * Returns integer or null if the part is not covered ("-" or empty).
 * @param {object} armourSignals - the armour signal subtree (item.armour)
 * @param {'head'|'body'|'leftArm'|'rightArm'|'leftLeg'|'rightLeg'} part
 * @param {'ap'|'superAp'} kind
 */
export function gearArmourApForPart(armourSignals, part, kind = 'ap') {
    const apNode = armourSignals?.[kind];
    const raw = (
        part === 'head' ? apNode?.head?.value :
            part === 'body' ? apNode?.torso?.value :
                part === 'leftArm' || part === 'rightArm' ? apNode?.arms?.value :
                    part === 'leftLeg' || part === 'rightLeg' ? apNode?.legs?.value :
                        null
    );
    if (raw == null || raw === '-' || raw === '') return null;
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
}

function buildArmourComputed() {
    const c = { parts: {} };

    c.toughnessBase = computed(() =>
        calculateCharacteristicBase(
            characterState.characteristics?.T?.calculatedValue?.value ?? charVal("T"),
            characterState.characteristics?.T?.calculatedUnnatural?.value ?? charUnnatural("T")
        )
    );

    function shieldBonus(part) {
        return computed(() => {
            getItemVersion('meleeAttacks.list.items').value;
            let total = 0;
            for (const attack of Object.values(characterState.meleeAttacks?.list?.items ?? {})) {
                const s = attack?.shield;
                const ap = shieldApForPart(s, attack.group?.value, part);
                if (ap) total += ap;
            }
            return total;
        });
    }

    function gearArmourBonus(part, kind) {
        return computed(() => {
            getItemVersion('gear.list.items').value;
            let max = null;
            for (const item of Object.values(characterState.gear?.list?.items ?? {})) {
                if (item.gearType?.value !== 'armour') continue;
                if (!item.equipped?.value) continue;                // ← top-level equipped
                const ap = gearArmourApForPart(item.armour, part, kind);
                if (ap !== null) max = max === null ? ap : Math.max(max, ap);
            }
            return max;
        });
    }

    for (const part of ["head", "leftArm", "rightArm", "body", "leftLeg", "rightLeg"]) {
        c.parts[part] = {
            gearArmourAP: gearArmourBonus(part, 'ap'),
            gearSuperArmourAP: gearArmourBonus(part, 'superAp'),
            shieldBonus: shieldBonus(part),

            sum: computed(() => {
                const p = characterState.armour?.[part];
                const gearAP = c.parts[part].gearArmourAP.value;
                const base = gearAP !== null ? gearAP : num(p?.armourValue);
                return base + num(p?.extra1Value) + num(p?.extra2Value);
            }),
            total: computed(() => {
                const p = characterState.armour?.[part];
                const gearAP = c.parts[part].gearArmourAP.value;
                const base = gearAP !== null ? gearAP : num(p?.armourValue);
                return base
                    + num(p?.extra1Value)
                    + num(p?.extra2Value)
                    + c.parts[part].shieldBonus.value
                    + c.toughnessBase.value
                    + num(characterState.armour?.naturalArmourValue)
                    + num(characterState.armour?.machineValue)
                    + num(characterState.armour?.daemonicValue)
                    + num(characterState.armour?.otherArmourValue);
            }),
            toughnessSuper: computed(() =>
                c.toughnessBase.value + num(characterState.armour?.daemonicValue)
            ),
            superArmourSub: computed(() => {
                const p = characterState.armour?.[part];
                const gearSA = c.parts[part].gearSuperArmourAP.value;
                return gearSA !== null ? gearSA : num(p?.superArmour);
            }),
        };
    }

    c.ablativeWounds = computed(() =>
        sumEntryField('ablative_wounds', 'ablativeWounds')
    );

    c.woundsRemaining = computed(() =>
        num(characterState.armour?.woundsMax)
        + c.ablativeWounds.value
        - num(characterState.armour?.woundsCur)
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
                const item = characterState.gear.list.items[id];
                if (!item.carried?.value) continue;
                total += Math.round(num(item.weight) * 1000);
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
    if (!sk || sk.difficulty) return;

    sk.difficulty = computed(() => {
        getItemVersion('conditions.list.items').value;
        getItemVersion('gear.list.items').value;
        getItemVersion('cybernetics.list.items').value;

        const key = sk.characteristic?.value || "WS";
        const val = characterState.characteristics?.[key]?.valueForRolls?.value
            ?? charVal(key);

        let count = 0;
        if (sk.plus0?.value) count++;
        if (sk.plus10?.value) count++;
        if (sk.plus20?.value) count++;
        if (sk.plus30?.value) count++;

        // Prefer displayed name over map key (right-col skills have editable names)
        const displayName = sk.name?.value?.trim();
        const normalizedSkill = normalizeSkillName(displayName || skillId);

        const skillCondBonus = sumEntryField('skill_bonus', 'skillBonus',
            e => normalizeSkillName(e.name?.value) === normalizedSkill);

        return calculateTestDifficulty(val, calculateSkillAdvancement(count))
            + num(sk.miscBonus)
            + skillCondBonus;
    });
}


// ─── wireIntoState ────────────────────────────────────────────────────────────
// Rebuilds all module-level computeds from fresh signal instances, then assigns
// them onto characterState so resolvePath() and bindings.js can find them.
// Called at the end of attachComputeds() on every sheet load.

function wireIntoState() {
    characterState._entryIndex = computed(() => buildEntryIndex());
    armourComputed = buildArmourComputed();
    carryWeightComputed = buildCarryWeightComputed();
    experienceComputed = buildExperienceComputed();
    psykanaComputed = buildPsykanaComputed();

    if (!characterState.armour) characterState.armour = {};
    characterState.armour.toughnessBaseAbsorptionValue = armourComputed.toughnessBase;
    characterState.armour.woundsRemaining = armourComputed.woundsRemaining;
    characterState.armour.ablativeWounds = armourComputed.ablativeWounds;
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

    movementComputed = buildMovementComputed();
    if (!characterState.movement) characterState.movement = {};
    Object.assign(characterState.movement, movementComputed);

    initiativeBonusComputed = buildInitiativeBonusComputed();
    if (!characterState.initiative) characterState.initiative = {};
    characterState.initiative.conditionBonus = initiativeBonusComputed.total;
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
    // Tech Power Compensation
    attachCompensationComputed();

    // Experience items — attach computedCost signals.
    // experienceCost remains the editable stored field; computedCost is display-only.
    for (const id of Object.keys(s.experience?.experienceLog?.items ?? {})) {
        ExperienceItem.attachComputeds(id);
    }

    // Rebuild and wire module-level computeds (armour, carry weight, XP, PR)
    wireIntoState();
}