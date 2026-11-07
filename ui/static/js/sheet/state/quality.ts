// The Quality of a gear item (rulebook «IV. Арсенал › Редкость и качество»,
// alike in Black Crusade and Pathfinder Crusade): what it changes of the
// attacks linked to the item (state/itemLink.ts) and of its armour. Best.Q
// replaces Good.Q, they don't add up. What an item's own description says of
// its Quality the player types in as its entries.
//   Melee weapon: every test with it, attacks and Parry, Poor −10, Good +5,
//     Best +10; Best +1 Dmg and no Primitive.
//   Shield (a melee attack of the group "primary (shield)"): as a melee
//     weapon, but Best gives +1 shield AP instead of Dmg.
//   Ranged weapon: Reliability Poor −1, Good +1, Best +2, added to the
//     Reliability of its Special and kept within −2…+2; Best drops Primitive.
//     The sheet doesn't roll jams: it only shows the resulting property.
//   Armour: Poor −10 to all A tests while worn; Best +1 AP on every location
//     it covers. Their effects on called shots it only names in the title.
import { computed, signal, type Signal } from "@preact/signals-core";
import type { SheetSignals } from "../schema/sheet";
import type { Entry } from "./computed";
import { itemName, linkedItem, linkedLabel } from "./itemLink";
import type { GearItem } from "./materials";
import { textAt } from "./sync";

export type Quality = "Poor" | "Common" | "Good" | "Best";

/** The Quality of the item; Common for none or one the sheet does not know. */
export function qualityOf(item: GearItem): Quality {
    const q = String(item.quality?.value ?? "");
    return q === "Poor" || q === "Good" || q === "Best" ? q : "Common";
}

/** The Quality as the rulebook writes it, "Best.Q". */
export const qualityName = (q: Quality) => (q === "Common" ? "Comm.Q" : `${q}.Q`);

/** What the Quality adds to the tests with a melee weapon or shield. */
const TEST_MODS: { readonly [Q in Quality]: number } = { Poor: -10, Common: 0, Good: 5, Best: 10 };
/** What the Quality adds to the Reliability of a ranged weapon. */
const RELIABILITY_MODS: { readonly [Q in Quality]: number } = { Poor: -1, Common: 0, Good: 1, Best: 2 };

/** The Reliability properties by their value («Клин и Надёжность»). */
const RELIABILITY: readonly [number, string][] = [[-2, "Very Unreliable"], [-1, "Unreliable"], [1, "Reliable"], [2, "Very Reliable"]];

export const PRIMITIVE = "Primitive";

const SHIELD_GROUP = "primary (shield)";
const attackOf = (weaponPath: string) => weaponPath.replace(/\.tabs\.items\.[^.]+$/, "");

/** Whether the melee attack of `weaponPath`, the attack or one of its profiles, is a shield. */
export const isShield = (state: SheetSignals, weaponPath: string) => textAt(state, `${attackOf(weaponPath)}.group`) === SHIELD_GROUP;

/** The linked item of the weapon at `weaponPath` while it has a Quality other than Common. */
function qualityItem(state: SheetSignals, weaponPath: string): { item: GearItem; quality: Quality } | null {
    const item = linkedItem(state, weaponPath);
    const quality = item ? qualityOf(item) : "Common";
    return item && quality !== "Common" ? { item, quality } : null;
}

/** A modifier the Quality of the linked item gives a field of the weapon, as a weapon entry of the item does. */
export interface QualityAdd {
    add: number;
    label: string;
}

/**
 * What the Quality of the linked item adds to the field of the melee weapon
 * at `weaponPath`, a melee attack or one of its profiles: Hit and Parry its
 * test modifier, Dmg +1 of Best but to a shield. A ranged weapon gets none.
 */
export function qualityAdds(state: SheetSignals, weaponPath: string, field: string): QualityAdd[] {
    if (!weaponPath.startsWith("meleeAttacks.")) return [];
    const linked = qualityItem(state, weaponPath);
    if (!linked) return [];
    const add = field === "hit" || field === "parry" ? TEST_MODS[linked.quality]
        : field === "dmg" && linked.quality === "Best" && !isShield(state, weaponPath) ? 1
        : 0;
    return add ? [{ add, label: linkedLabel(linked.item, qualityName(linked.quality)) }] : [];
}

/** The shield AP the Quality of the shield's linked item adds: +1 of Best. */
export function shieldQualityAp(state: SheetSignals, attackPath: string): QualityAdd | null {
    const linked = qualityItem(state, attackPath);
    return linked?.quality === "Best" ? { add: 1, label: linkedLabel(linked.item, qualityName("Best")) } : null;
}

/** The properties of a Special, without their values in brackets: "Reliable, Tearing (2)" is reliable and tearing. */
const propertyNames = (special: string) => special.split(/[,;]/).map(p => p.trim().replace(/\s*\(.*\)$/, "")).filter(Boolean);

/** How the Quality of the linked item changes the Special of a weapon. */
export interface QualitySpecial {
    added: string[];
    removed: string[];
    /** Why, for the title. */
    lines: string[];
}

/**
 * What the Quality of the linked item adds to and removes from the Special
 * of the weapon at `weaponPath`, a melee profile or ranged attack: the
 * Reliability property of a ranged weapon that its own and the Quality's sum
 * to, and Primitive with Best. Null when it changes nothing.
 */
export function qualitySpecial(state: SheetSignals, weaponPath: string): QualitySpecial | null {
    const linked = qualityItem(state, weaponPath);
    if (!linked) return null;
    const { item, quality } = linked;
    const source = `${qualityName(quality)} of ${itemName(item)}`;
    const own = propertyNames(textAt(state, `${weaponPath}.special`));
    const ownKeys = own.map(p => p.toLowerCase());
    const result: QualitySpecial = { added: [], removed: [], lines: [] };
    if (weaponPath.startsWith("rangedAttacks.")) {
        const ownReliability = RELIABILITY.filter(([, name]) => ownKeys.includes(name.toLowerCase()));
        const before = Math.max(-2, Math.min(2, ownReliability.reduce((sum, [n]) => sum + n, 0)));
        const after = Math.max(-2, Math.min(2, before + RELIABILITY_MODS[quality]));
        if (after !== before) {
            result.removed.push(...ownReliability.map(([, name]) => own[ownKeys.indexOf(name.toLowerCase())]));
            const name = RELIABILITY.find(([n]) => n === after)?.[1];
            if (name) result.added.push(name);
            result.lines.push(`Reliability ${signedOrZero(before)} ${signedOrZero(RELIABILITY_MODS[quality])} ${source} = ${signedOrZero(after)}${name ? `: ${name}` : ""}`);
        }
    }
    if (quality === "Best" && ownKeys.includes(PRIMITIVE.toLowerCase())) {
        result.removed.push(own[ownKeys.indexOf(PRIMITIVE.toLowerCase())]);
        result.lines.push(`No ${PRIMITIVE}: ${source}`);
    }
    return result.lines.length ? result : null;
}

/** The Special `special` without the properties `removed`, whatever their values in brackets: "Primitive, Tearing" less Primitive is "Tearing". */
export function withoutProperties(special: string, removed: readonly string[]): string {
    const names = new Set(removed.map(p => p.toLowerCase()));
    return special.split(/[,;]/).map(p => p.trim())
        .filter(p => p && !names.has(p.replace(/\s*\(.*\)$/, "").toLowerCase()))
        .join(", ");
}

/**
 * The Special of the weapon at `weaponPath` as it shows unfocused: its own
 * without what the Quality of the linked item removes, and why, for the
 * title. Null while the Quality removes nothing: the field shows its own.
 */
export function shownSpecial(state: SheetSignals, weaponPath: string): { text: string; title: string } | null {
    const quality = qualitySpecial(state, weaponPath);
    if (!quality?.removed.length) return null;
    const own = textAt(state, `${weaponPath}.special`);
    return { text: withoutProperties(own, quality.removed), title: [`Own: ${own}`, ...quality.lines].join("\n") };
}

const signedOrZero = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/** The AP the Quality adds to every location the item's armour covers: +1 of Best. */
export const armourQualityAp = (item: GearItem) => (qualityOf(item) === "Best" ? 1 : 0);

// The entry of Poor armour, as a condition's signals: −10 to all A tests.
const POOR_ARMOUR_ENTRY = Object.fromEntries(Object.entries({ type: "roll_bonus", name: "A", rollBonus: "-10" })
    .map(([k, v]) => [k, signal(v)])) as unknown as Entry;

// The source each item's entry is named by, kept per item: entries are read inside computeds.
const sources = new WeakMap<GearItem, { name: Signal<string> }>();

/** The entries the Quality of the armour item adds while worn: Poor's −10 to A tests; none for another type or Quality. */
export function armourQualityEntries(item: GearItem): { entry: Entry; source: { name: Signal<string> } }[] {
    if (item.gearType?.value !== "armour" || qualityOf(item) !== "Poor") return [];
    let source = sources.get(item);
    if (!source) {
        // Read-only, as no reader of a source writes its name.
        source = { name: computed(() => `${itemName(item)} ${qualityName("Poor")}`) as Signal<string> };
        sources.set(item, source);
    }
    return [{ entry: POOR_ARMOUR_ENTRY, source }];
}

/** What the Quality of the item does, by its type, for the title of its select. */
export function qualityTitle(item: GearItem): string {
    const q = qualityOf(item);
    const type = String(item.gearType?.value ?? "");
    const head = `Quality: ${qualityName(q)}`;
    if (q === "Common") return head;
    const effects: { [type: string]: { [Q in Exclude<Quality, "Common">]: string } } = {
        weapon: {
            Poor: "Melee: −10 to its tests, Parry too. Ranged: Reliability −1.",
            Good: "Melee: +5 to its tests, Parry too. Ranged: Reliability +1.",
            Best: "Melee: +10 to its tests, Parry too, +1 Dmg (a shield: +1 AP instead). Ranged: Reliability +2. No Primitive.",
        },
        armour: {
            Poor: "−10 to all A tests while worn.",
            Good: "Called shots at the wearer's joints and eyes −10.",
            Best: "Called shots at the wearer's joints and eyes −10. +1 AP on every location it covers; +2 AP more against hits in a joint (after its reduction) and in the eye (a closed helmet only). No Primitive.",
        },
    };
    const other = { Poor: "−10 to tests with it, unless its description says otherwise.", Good: "+5 to tests with it, unless its description says otherwise.", Best: "+10 to tests with it, unless its description says otherwise." };
    const counted = type === "weapon" ? "\nCounted in the linked attacks." : type === "armour" && q !== "Good" ? "\nCounted in the armour." : "";
    return `${head}\n${(effects[type] ?? other)[q]}${counted}`;
}
