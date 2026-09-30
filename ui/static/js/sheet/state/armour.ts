// The armour of the body parts: what gear, shields and entries add to each,
// the totals and the wounds. Only the Armour block shows it, so the block
// builds these computeds when it mounts; a total and the breakdown under it
// come from the same ones.
import { computed, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { BODY_PARTS, type BodyPartKey } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { parseDefenseSectors, resolveStackExpr } from "../system";
import { characteristicBonus } from "./characteristics";
import { collectEntries, sumEntryField } from "./computed";
import { characterState } from "./state";

type GearArmour = SheetSignals["gear"]["list"]["items"][string]["armour"];
type MeleeAttack = SheetSignals["meleeAttacks"]["list"]["items"][string];

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;
const nameOf = (item: { name: Signal<string> }) => String(item.name?.value || "—");

// The field of a gear item's armour that covers each body part.
const GEAR_FIELD: { readonly [P in BodyPartKey]: keyof GearArmour["ap"] } = {
    head: "head", body: "torso", leftArm: "arms", rightArm: "arms", leftLeg: "legs", rightLeg: "legs",
};

/** The AP of a gear item's armour on the part; null when it does not cover it ("-" or empty). */
function gearAp(armour: GearArmour | undefined, part: BodyPartKey, kind: "ap" | "superAp"): number | null {
    const raw = armour?.[kind]?.[GEAR_FIELD[part]]?.value;
    if (raw === undefined || raw === null || raw === "-" || raw === "") return null;
    const n = parseInt(String(raw), 10);
    return Number.isNaN(n) ? null : n;
}

/** The AP the shield of a melee attack gives the part; null unless it is an equipped shield covering it. */
function shieldAp(attack: MeleeAttack, part: BodyPartKey): number | null {
    const shield = attack.shield;
    if (attack.group?.value !== "primary (shield)" || !shield?.equipped?.value) return null;
    const { alwaysParts, defensiveParts } = parseDefenseSectors(shield.defenseSectors?.value, shield.arm?.value ?? "left");
    if (alwaysParts.has(part) || (shield.defensive?.value && defensiveParts.has(part))) return num(shield.ap);
    return null;
}

export type ApSource = { name: string | null; apType: string; ap: number };

// AP of these types is the same under every part. Natural, daemonic and
// machine AP do not stack: the highest of the manual field and the entries of
// the type counts. Other AP stacks.
const AP_CATEGORIES = [
    { apType: "daemonic", field: "daemonicValue", stacks: false },
    { apType: "natural", field: "naturalArmourValue", stacks: false },
    { apType: "machine", field: "machineValue", stacks: false },
    { apType: "other", field: "otherArmourValue", stacks: true },
] as const;

type ApCategory = (typeof AP_CATEGORIES)[number];
type CategoryAp = { ap: number; sources: ApSource[] };

/** The AP of a category and what makes it up: every non-zero source that stacks, else the one that counts. */
function categoryAp({ apType, field, stacks }: ApCategory): CategoryAp {
    const manual: ApSource = { name: null, apType, ap: num(characterState.armour?.[field]) };
    const entries: ApSource[] = collectEntries("bonus_ap")
        .filter(({ entry }) => (entry.apType?.value || "natural") === apType)
        .map(({ entry, stacks: n, source }) => ({ name: nameOf(source), apType, ap: resolveStackExpr(entry.apValue?.value, n) }));
    if (stacks) {
        return {
            ap: entries.reduce((sum, s) => sum + s.ap, manual.ap),
            sources: [...entries, manual].filter(s => s.ap),
        };
    }
    const best = entries.reduce((b, s) => (s.ap > b.ap ? s : b), manual);
    return { ap: best.ap, sources: best.ap ? [best] : [] };
}

export type GearPiece = { name: string; ap: number | null; superAp: number | null };
export type Shield = { name: string; ap: number };

function bodyPartComputeds(part: BodyPartKey, toughnessBase: ReadonlySignal<number>, categoriesAp: ReadonlySignal<number>, daemonic: ReadonlySignal<number>) {
    const own = () => characterState.armour?.[part];
    const pieces = computed((): GearPiece[] => {
        return Object.values(characterState.gear?.list?.items ?? {})
            .filter(item => item.gearType?.value === "armour" && item.equipped?.value)
            .map(item => ({ name: nameOf(item), ap: gearAp(item.armour, part, "ap"), superAp: gearAp(item.armour, part, "superAp") }))
            .filter(p => p.ap !== null || p.superAp !== null);
    });
    const shields = computed((): Shield[] => {
        return Object.values(characterState.meleeAttacks?.list?.items ?? {})
            .map(attack => ({ name: nameOf(attack), ap: shieldAp(attack, part) }))
            .filter((s): s is Shield => s.ap !== null);
    });
    // Worn armour gear replaces the part's own armour and super armour; the best piece counts.
    const best = (kind: "ap" | "superAp") => {
        const values = pieces.value.map(p => p[kind]).filter((n): n is number => n !== null);
        return values.length ? Math.max(...values) : null;
    };
    const gearArmour = computed(() => best("ap"));
    const sum = computed(() => (gearArmour.value ?? num(own()?.armourValue)) + num(own()?.extra1Value) + num(own()?.extra2Value));

    return {
        pieces,
        shields,
        gearArmour,
        sum,
        total: computed(() => sum.value + shields.value.reduce((t, s) => t + s.ap, 0) + toughnessBase.value + categoriesAp.value),
        toughnessSuper: computed(() => toughnessBase.value + daemonic.value),
        superArmourSub: computed(() => best("superAp") ?? num(own()?.superArmour)),
    };
}

export type BodyPartComputeds = ReturnType<typeof bodyPartComputeds>;

/** The armour computeds of the open sheet. */
export function armourComputeds() {
    const toughnessBase = computed(() => {
        return characteristicBonus("T");
    });
    const categories = Object.fromEntries(AP_CATEGORIES.map(c => [c.apType, computed(() => categoryAp(c))])) as
        { [T in ApCategory["apType"]]: ReadonlySignal<CategoryAp> };
    const categoriesAp = computed(() => AP_CATEGORIES.reduce((sum, c) => sum + categories[c.apType].value.ap, 0));
    const daemonic = computed(() => categories.daemonic.value.ap);
    const ablativeWounds = computed(() => sumEntryField("ablative_wounds", "ablativeWounds"));

    return {
        toughnessBase,
        misc: computed(() => AP_CATEGORIES.flatMap(c => categories[c.apType].value.sources)),
        ablativeWounds,
        woundsRemaining: computed(() => num(characterState.armour?.woundsMax) + ablativeWounds.value - num(characterState.armour?.woundsCur)),
        parts: Object.fromEntries(BODY_PARTS.map(({ key }) => [key, bodyPartComputeds(key, toughnessBase, categoriesAp, daemonic)])) as
            { [P in BodyPartKey]: BodyPartComputeds },
    };
}
