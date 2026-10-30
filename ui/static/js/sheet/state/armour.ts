// The armour of the body parts: what gear, shields and entries add to each,
// the totals and the wounds. Only the Armour block shows it, so the block
// builds these computeds when it mounts; a total and the breakdown under it
// come from the same ones.
import { computed, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { BODY_PARTS, type BodyPartKey } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { parseDefenseSectors, resolveStackExpr, signed } from "../system";
import { characteristicBonus } from "./characteristics";
import { collectEntries, sumEntryField } from "./computed";
import { isBroken, materialOf, type GearItem } from "./materials";

type GearArmour = GearItem["armour"];
type MeleeAttack = SheetSignals["meleeAttacks"]["list"]["items"][string];

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;
const nameOf = (item: { name: Signal<string> }) => String(item.name?.value || "—");

// The field of a gear item's armour that covers each body part.
const GEAR_FIELD: { readonly [P in BodyPartKey]: GearLocation } = {
    head: "head", body: "torso", leftArm: "arms", rightArm: "arms", leftLeg: "legs", rightLeg: "legs",
};

/** The AP typed in a location of a gear item's armour; null when it does not cover it ("-" or empty). */
function ownAp(armour: GearArmour | undefined, location: GearLocation, kind: "ap" | "superAp"): number | null {
    const raw = armour?.[kind]?.[location]?.value;
    if (raw === undefined || raw === null || raw === "-" || raw === "") return null;
    const n = parseInt(String(raw), 10);
    return Number.isNaN(n) ? null : n;
}

export type GearLocation = keyof GearArmour["ap"];

export interface GearApTotal {
    own: number;
    total: number;
    /** The material or Broken changes it, even when the total comes out as the own value. */
    modified: boolean;
    /** How the total is made up, for its title. */
    lines: string[];
}

/**
 * The AP of a gear item's armour on `location`: its own plus its material's,
 * halved (rounded down) while it is broken, never below 0. Super armour is
 * only its own. Null when the item does not cover the location.
 */
export function gearApTotal(item: GearItem, location: GearLocation, kind: "ap" | "superAp" = "ap"): GearApTotal | null {
    const own = ownAp(item.armour, location, kind);
    if (own === null) return null;
    const lines = [`${own} ${String(item.name?.value || "own")}`];
    if (kind === "superAp") return { own, total: own, modified: false, lines };
    let total = own;
    const material = materialOf(item);
    if (material?.ap) {
        total += material.ap;
        lines.push(`${signed(material.ap)} ${material.name}`);
    }
    if (isBroken(item)) {
        total = Math.floor(total / 2);
        lines.push("÷ 2 Broken");
    }
    total = Math.max(0, total);
    const modified = lines.length > 1;
    lines.push(`= ${total}`);
    return { own, total, modified, lines };
}

/** The AP of a gear item's armour on the part; null when it does not cover it. */
const gearAp = (item: GearItem, part: BodyPartKey, kind: "ap" | "superAp") => gearApTotal(item, GEAR_FIELD[part], kind)?.total ?? null;

/**
 * The AP the shield of a melee attack gives the part; null unless it is an
 * equipped shield covering it. Its zones in brackets cover only in the
 * Defensive stance.
 */
function shieldAp(attack: MeleeAttack, part: BodyPartKey, defensive: boolean): number | null {
    const shield = attack.shield;
    if (attack.group?.value !== "primary (shield)" || !shield?.equipped?.value) return null;
    const { alwaysParts, defensiveParts } = parseDefenseSectors(shield.defenseSectors?.value, shield.arm?.value ?? "left");
    if (alwaysParts.has(part) || (defensive && defensiveParts.has(part))) return num(shield.ap);
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
function categoryAp(state: SheetSignals, { apType, field, stacks }: ApCategory): CategoryAp {
    const manual: ApSource = { name: null, apType, ap: num(state.armour?.[field]) };
    const entries: ApSource[] = collectEntries(state, "bonus_ap")
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

function bodyPartComputeds(state: SheetSignals, part: BodyPartKey, toughnessBase: ReadonlySignal<number>, categoriesAp: ReadonlySignal<number>, daemonic: ReadonlySignal<number>) {
    const own = () => state.armour?.[part];
    const pieces = computed((): GearPiece[] => {
        return Object.values(state.gear?.list?.items ?? {})
            .filter(item => item.gearType?.value === "armour" && item.equipped?.value)
            .map(item => ({ name: nameOf(item), ap: gearAp(item, part, "ap"), superAp: gearAp(item, part, "superAp") }))
            .filter(p => p.ap !== null || p.superAp !== null);
    });
    const shields = computed((): Shield[] => {
        const defensive = state.meleeAttacks?.stance?.value === "defensive";
        return Object.values(state.meleeAttacks?.list?.items ?? {})
            .map(attack => ({ name: nameOf(attack), ap: shieldAp(attack, part, defensive) }))
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

/** The wounds left of the maximum and of the ablative wounds, which a hit takes first. */
export function woundsLeft(max: number, ablative: number, taken: number): { left: number; ablativeLeft: number } {
    return { left: max - Math.max(0, taken - ablative), ablativeLeft: Math.min(ablative, Math.max(0, ablative - taken)) };
}

export type ArmourComputeds = ReturnType<typeof armourComputeds>;

/** The armour computeds of the sheet. */
export function armourComputeds(state: SheetSignals) {
    const toughnessBase = computed(() => {
        return characteristicBonus(state, "T");
    });
    const categories = Object.fromEntries(AP_CATEGORIES.map(c => [c.apType, computed(() => categoryAp(state, c))])) as
        { [T in ApCategory["apType"]]: ReadonlySignal<CategoryAp> };
    const categoriesAp = computed(() => AP_CATEGORIES.reduce((sum, c) => sum + categories[c.apType].value.ap, 0));
    const daemonic = computed(() => categories.daemonic.value.ap);
    const ablativeWounds = computed(() => sumEntryField(state, "ablative_wounds", "ablativeWounds"));

    return {
        toughnessBase,
        misc: computed(() => AP_CATEGORIES.flatMap(c => categories[c.apType].value.sources)),
        ablativeWounds,
        woundsRemaining: computed(() => num(state.armour?.woundsMax) + ablativeWounds.value - num(state.armour?.woundsCur)),
        parts: Object.fromEntries(BODY_PARTS.map(({ key }) => [key, bodyPartComputeds(state, key, toughnessBase, categoriesAp, daemonic)])) as
            { [P in BodyPartKey]: BodyPartComputeds },
    };
}
