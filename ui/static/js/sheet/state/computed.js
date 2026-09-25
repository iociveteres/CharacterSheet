// ui/static/js/sheet/state/computed.js

import { computed } from "@preact/signals-core";
import { characterState } from "./state.js";
import { attachAllItemComputeds } from "./itemComputeds.js";
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


// ─── Characteristics ──────────────────────────────────────────────────────────

const FATIGUE_ALL = new Set(['WS', 'BS', 'S', 'A', 'I', 'P', 'W', 'F']);
const FATIGUE_MENTAL = new Set(['I', 'P', 'W', 'F']);
const FATIGUE_PHYSICAL = new Set(['WS', 'BS', 'S', 'A']);

function attachCharacteristicComputeds(key) {
    const char = characterState.characteristics?.[key];
    if (!char) return;

    const charFilter = e => e.name?.value?.toUpperCase() === key.toUpperCase();

    // char_override: replaces the permanent value and/or unnatural outright.
    // Value and unnatural are resolved fully independently of each other —
    // they are NOT paired per-entry. One condition can override just the value
    // (e.g. value 60, unnatural left blank) while a separate, unrelated
    // condition overrides just the unnatural (e.g. value left blank, unnatural
    // 4). Each field takes the highest override among entries that set that
    // specific field; an entry with a blank value field simply doesn't
    // participate in the value comparison (and likewise for unnatural).
    const overrideEntry = computed(() => {
        let value = null;
        let unnatural = null;

        for (const { entry, stacks } of collectEntries('char_override', charFilter)) {
            const rawValue = entry.overrideValue?.value;
            if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '') {
                const v = resolveStackExpr(rawValue, stacks);
                if (value === null || v > value) value = v;
            }

            const rawUnnatural = entry.overrideUnnatural?.value;
            if (rawUnnatural !== undefined && rawUnnatural !== null && String(rawUnnatural).trim() !== '') {
                const u = resolveStackExpr(rawUnnatural, stacks);
                if (unnatural === null || u > unnatural) unnatural = u;
            }
        }

        return { value, unnatural };
    });

    char.calculatedValue = computed(() => {
        const override = overrideEntry.value.value;
        const base = override !== null ? override : (parseInt(char.value?.value, 10) || 0);

        let bonus = 0, cap = Infinity;
        for (const { entry, stacks } of collectEntries('char_bonus', charFilter)) {
            bonus += resolveStackExpr(entry.bonus?.value, stacks);
        }
        for (const { entry, stacks } of collectEntries('char_cap', charFilter)) {
            const n = resolveStackExpr(entry.cap?.value, stacks);
            if (n > 0) cap = Math.min(cap, n);
        }
        const raw = base + bonus;
        return cap === Infinity ? raw : Math.min(raw, cap);
    });

    char.calculatedUnnatural = computed(() => {
        const override = overrideEntry.value.unnatural;
        const base = override !== null ? override : (parseInt(char.unnatural?.value, 10) || 0);

        return base + collectEntries('char_bonus', charFilter)
            .reduce((acc, { entry, stacks }) =>
                acc + resolveStackExpr(entry.unnaturalBonus?.value, stacks), 0);
    });

    char.rollBonus = computed(() => {
        let total = collectEntries('roll_bonus', charFilter)
            .reduce((acc, { entry, stacks }) =>
                acc + resolveStackExpr(entry.rollBonus?.value, stacks), 0);

        const cur = Number(characterState.fatigue?.fatigueCur?.value) || 0;
        if (cur > 0) {
            const mode = characterState.fatigue?.fatigueMode?.value ?? 'all';
            const affected =
                mode === 'mental' ? FATIGUE_MENTAL :
                    mode === 'physical' ? FATIGUE_PHYSICAL :
                        mode === 'nothing' ? null :
                            FATIGUE_ALL;

            if (affected?.has(key)) total -= 10;
        }

        return total;
    });

    char.valueForRolls = computed(() =>
        char.calculatedValue.value + char.rollBonus.value
    );

    char.bonusSuccesses = computed(() =>
        calculateBonusSuccesses(char.calculatedUnnatural.value)
    );
}

// ─── Tech-power compensation roll ─────────────────────────────────────────────

/** T − 10 × X, plus the enabled extras. */
function attachCompensationComputed() {
    const r = characterState.technoArcana?.compensationRoll;
    if (!r) return;

    r.total = computed(() => {
        const base = characterState.characteristics?.T?.valueForRolls?.value ?? 0;
        const extra = e => (e?.enabled?.value ? num(e?.value) : 0);
        return base - 10 * num(r.modifier) + extra(r.extra1) + extra(r.extra2);
    });
}

// ─── Initiative ───────────────────────────────────────────────────────────────

const INITIATIVE_BONUS_FIELDS = [
    { key: 'WS', id: 'wsBonus' },
    { key: 'BS', id: 'bsBonus' },
    { key: 'S', id: 'sBonus' },
    { key: 'T', id: 'tBonus' },
    { key: 'A', id: 'aBonus' },
    { key: 'I', id: 'iBonus' },
    { key: 'P', id: 'pBonus' },
    { key: 'W', id: 'wBonus' },
    { key: 'F', id: 'fBonus' },
    { key: 'Cor', id: 'corBonus' },
    { key: 'Inf', id: 'infBonus' },
];

/** "2d10+3" gives { dice: "2d10", bonus: 3 }; anything else is its own dice with no bonus. */
export function parseDiceBonus(diceStr) {
    const s = (diceStr ?? '').trim();
    const m = s.match(/^([0-9]*d[0-9]+)\s*([+-]\s*\d+)?$/i);
    if (!m) return { dice: s || 'd10', bonus: 0 };
    return {
        dice: m[1],
        bonus: m[2] ? parseInt(m[2].replace(/\s/g, ''), 10) : 0
    };
}

/**
 * The initiative modifier (characteristic bases, flat and dice bonus, entries)
 * and the roll expression, e.g. "d10+7".
 */
function buildInitiativeComputed(ini) {
    const modifier = computed(() => {
        const { bonus: diceBonus } = parseDiceBonus(ini.dice?.value);

        let charTotal = 0;
        for (const { key, id } of INITIATIVE_BONUS_FIELDS) {
            if (!ini[id]?.value) continue;
            const char = characterState.characteristics?.[key];
            if (!char) continue;
            charTotal += calculateCharacteristicBase(
                char.calculatedValue?.value ?? 0,
                char.calculatedUnnatural?.value ?? 0
            );
        }

        return charTotal + num(ini.flatBonus) + diceBonus + num(ini.conditionBonus);
    });

    const roll = computed(() => {
        const { dice } = parseDiceBonus(ini.dice?.value);
        const total = modifier.value;
        if (total === 0) return dice;
        if (total > 0) return `${dice}+${total}`;
        return `${dice}${total}`;
    });

    return { modifier, roll };
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

    /**
     * Global AP categories (apply equally to every body part, same as the manual
     * natural/daemonic/machine/other fields always have).
     *
     * mode 'max' (natural, daemonic, machine): the manual field and every matching
     * bonus_ap entry are compared — highest wins, they do not stack.
     *
     * mode 'sum' (other): the manual field plus every matching bonus_ap entry are
     * added together — "other" always stacks.
     */
    function bonusApCategory(category, manualFieldKey, mode = 'max') {
        return computed(() => {
            const manual = num(characterState.armour?.[manualFieldKey]);
            const matches = collectEntries('bonus_ap',
                e => (e.apType?.value || 'natural') === category);

            if (mode === 'sum') {
                return matches.reduce((acc, { entry, stacks }) =>
                    acc + resolveStackExpr(entry.apValue?.value, stacks), manual);
            }

            let best = manual;
            for (const { entry, stacks } of matches) {
                const v = resolveStackExpr(entry.apValue?.value, stacks);
                if (v > best) best = v;
            }
            return best;
        });
    }

    c.naturalArmour = bonusApCategory('natural', 'naturalArmourValue');
    c.daemonicArmour = bonusApCategory('daemonic', 'daemonicValue');
    c.machineArmour = bonusApCategory('machine', 'machineValue');
    c.otherArmour = bonusApCategory('other', 'otherArmourValue', 'sum');

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
                if (!item.equipped?.value) continue;
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
                    + c.naturalArmour.value
                    + c.machineArmour.value
                    + c.daemonicArmour.value
                    + c.otherArmour.value;
            }),
            toughnessSuper: computed(() =>
                c.toughnessBase.value + c.daemonicArmour.value
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

const SKILL_ADVANCES = ['plus0', 'plus10', 'plus20', 'plus30'];

/**
 * The test difficulty of a skill row or custom skill tested on `charKey`: its
 * advances and misc bonus, and the skill_bonus entries named `name`.
 */
export function skillDifficulty(skill, charKey, name) {
    const val = characterState.characteristics?.[charKey]?.valueForRolls?.value ?? 0;
    const advances = SKILL_ADVANCES.filter(key => skill[key]?.value).length;
    const skillName = normalizeSkillName(name);
    const bonus = skillName
        ? sumEntryField('skill_bonus', 'skillBonus', e => normalizeSkillName(e.name?.value) === skillName)
        : 0;
    return calculateTestDifficulty(val, calculateSkillAdvancement(advances)) + num(skill.miscBonus) + bonus;
}

/** A skill row is named by its row key until the player names it (right-column rows). */
export const skillRowName = (skill, skillId) => skill.name?.value?.trim() || skillId;

function attachStandardSkillComputed(skillId, mapName) {
    const sk = characterState[mapName]?.[skillId];
    if (!sk || sk.difficulty) return;

    sk.difficulty = computed(() =>
        skillDifficulty(sk, sk.characteristic?.value || "WS", skillRowName(sk, skillId)));
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
    const initiative = buildInitiativeComputed(characterState.initiative);
    characterState.initiative.modifier = initiative.modifier;
    characterState.initiative.initiative = initiative.roll;
}

// ─── attachComputeds ─────────────────────────────────────────────────────────

export function attachComputeds(s) {
    // Characteristics
    for (const key of Object.keys(s.characteristics ?? {})) {
        attachCharacteristicComputeds(key);
    }

    // Standard skills — tree is built from DOM so all rows are present
    for (const id of Object.keys(s.skillsLeft ?? {})) attachStandardSkillComputed(id, 'skillsLeft');
    for (const id of Object.keys(s.skillsRight ?? {})) attachStandardSkillComputed(id, 'skillsRight');

    // Custom skills, attacks, powers and advancements
    attachAllItemComputeds(s);

    // Tech Power Compensation
    attachCompensationComputed();

    // Rebuild and wire module-level computeds (armour, carry weight, XP, PR)
    wireIntoState();
}