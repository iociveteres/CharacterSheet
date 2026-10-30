// Weapon entries of conditions, gear and implants (type weapon_bonus): what a
// condition adds to a field of some weapons, as a power of Pathfinder Crusade
// lengthening the reach. The name says which weapons, words separated by
// commas: Melee or Ranged, a melee group or ranged class, a melee profile or
// the name of a weapon of the sheet. An unknown word turns the entry off, as
// an unknown characteristic does a Roll Bonus. Inside a gear item "This item"
// names the attacks linked to the item (state/itemLink.ts): such an entry
// counts for them whether or not the item is equipped, and nowhere else. A
// value "×2" multiplies the range of a ranged attack (Distance, Hurling).
import { readMultiplier } from "../damage";
import { MELEE_GROUPS, MELEE_PROFILES, RANGED_CLASSES, optionLabel, optionValue, type Option } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { resolveStackExpr, signed } from "../system";
import { collectEntries, gearItemEntries, type Entry, type EntryRef } from "./computed";
import { idsInOrder } from "./gridOrder";
import { linkedItem, linkedLabel } from "./itemLink";
import type { RangeStep, Step } from "./grips";
import { textAt } from "./sync";

export type WeaponField = "rng" | "rngMax" | "rngMin" | "balance" | "dmg" | "pen";

/** The words that name all the weapons of a kind. */
export const WEAPON_KINDS: readonly Option[] = [{ value: "melee", label: "Melee" }, { value: "ranged", label: "Ranged" }];

/** The melee groups and ranged classes, named as their selects show them. */
export const WEAPON_GROUPS: readonly Option[] = [...MELEE_GROUPS, ...RANGED_CLASSES];

/** The melee profiles, but Other and none. */
export const WEAPON_PROFILES: readonly Option[] = MELEE_PROFILES.filter(o => optionValue(o) !== "" && optionValue(o) !== "no");

const lower = (s: string) => s.trim().toLowerCase();
const KNOWN = new Set([...WEAPON_KINDS, ...WEAPON_GROUPS, ...WEAPON_PROFILES].flatMap(o => [lower(String(optionValue(o))), lower(optionLabel(o))]));

/** The words of an entry's name, separated by commas. */
export const weaponWords = (name: string): string[] => name.split(",").map(lower).filter(Boolean);

/** The word of an entry inside a gear item that names the attacks linked to the item. */
export const THIS_ITEM = "This item";
const THIS_ITEM_WORD = lower(THIS_ITEM);

/** Whether the weapon entry names the attacks linked to its item. */
const namesThisItem = (entry: Entry) => weaponWords(String(entry.name?.value ?? "")).includes(THIS_ITEM_WORD);

/** The names of the weapons of the sheet, melee then ranged. */
export function weaponNames(state: SheetSignals): string[] {
    const names = ["meleeAttacks", "rangedAttacks"].flatMap(block =>
        idsInOrder(state, `${block}.list.items`).map(id => textAt(state, `${block}.list.items.${id}.name`).trim()));
    return [...new Set(names.filter(Boolean))];
}

/** The words of `name` that name no weapon of the sheet nor anything a weapon is; "This item" is known `inItem`, in an entry of a gear item. */
export function unknownWeaponWords(state: SheetSignals, name: string, inItem = false): string[] {
    const names = new Set(weaponNames(state).map(lower));
    return weaponWords(name).filter(w => !KNOWN.has(w) && !names.has(w) && !(inItem && w === THIS_ITEM_WORD));
}

/** What a weapon is, as the words of an entry name it. */
interface WeaponIs {
    kind: "melee" | "ranged";
    group: string;
    name: string;
    profiles: string[];
}

/** What the melee attack or ranged attack at `weaponPath` is; a melee profile tab is its attack with its own profile. */
function weaponIs(state: SheetSignals, weaponPath: string): WeaponIs {
    const melee = weaponPath.startsWith("meleeAttacks.");
    const attack = weaponPath.replace(/\.tabs\.items\.[^.]+$/, "");
    const tabs = attack === weaponPath ? idsInOrder(state, `${attack}.tabs.items`).map(id => `${attack}.tabs.items.${id}`) : [weaponPath];
    return {
        kind: melee ? "melee" : "ranged",
        group: lower(textAt(state, `${attack}.${melee ? "group" : "class"}`)),
        name: lower(textAt(state, `${attack}.name`)),
        profiles: melee ? tabs.map(t => lower(textAt(state, `${t}.profile`))) : [],
    };
}

/** Whether `word` names the weapon `is`: its kind, group or class, a profile or its name. */
function names(word: string, is: WeaponIs): boolean {
    if (word === is.kind || (is.name && word === is.name)) return true;
    const option = (list: readonly Option[], value: string) => list.some(o => lower(String(optionValue(o))) === value && (word === value || word === lower(optionLabel(o))));
    return (is.group !== "" && option(WEAPON_GROUPS, is.group)) || is.profiles.some(p => option(WEAPON_PROFILES, p));
}

/** A weapon entry that adds to the weapon, and the source to name it by. */
export interface WeaponAdd {
    add: number;
    label: string;
}

/** A weapon entry that multiplies the field, rounded down unless `roundUp`. */
export interface WeaponFactor {
    factor: number;
    roundUp: boolean;
    label: string;
}

/** A weapon entry that counts for the weapon. */
export type WeaponBonus = WeaponAdd | WeaponFactor;

const isAdd = (b: WeaponBonus): b is WeaponAdd => "add" in b;
const isFactor = (b: WeaponBonus): b is WeaponFactor => "factor" in b;

/** What the value of `entry` does at `stacks`: "×2" multiplies, anything else adds as the stacks resolve it. */
function bonusOf(entry: Entry, stacks: number, label: string): WeaponBonus {
    const factor = readMultiplier(String(entry.weaponBonus?.value ?? ""));
    return factor ? { ...factor, label } : { add: resolveStackExpr(entry.weaponBonus?.value, stacks), label };
}

const ofField = (field: WeaponField) => (e: Entry) => (e.weaponField?.value || "rng") === field;

/**
 * What the weapon entries of `field` do to the weapon at `weaponPath`: a
 * melee attack, one of its profile tabs or a ranged attack. The entries of
 * conditions, implants and equipped gear by the words of their names; those
 * of the linked item that name "This item", equipped or not.
 */
export function weaponBonuses(state: SheetSignals, weaponPath: string, field: WeaponField): WeaponBonus[] {
    // An item's entry naming "This item" counts only through the link, below.
    const entries = collectEntries(state, "weapon_bonus", ofField(field)).filter(ref => !(ref.item && namesThisItem(ref.entry)));
    const item = linkedItem(state, weaponPath);
    const own = item
        ? gearItemEntries(item).filter(ref => ref.entry.type?.value === "weapon_bonus" && ofField(field)(ref.entry) && namesThisItem(ref.entry))
        : [];
    if (!entries.length && !own.length) return [];
    const is = weaponIs(state, weaponPath);
    const counts = (ref: EntryRef, inItem: boolean) => {
        const name = String(ref.entry.name?.value ?? "");
        return !unknownWeaponWords(state, name, inItem).length && (inItem || weaponWords(name).some(w => names(w, is)));
    };
    return [
        ...entries.filter(ref => counts(ref, false)).map(ref => bonusOf(ref.entry, ref.stacks, String(ref.source.name?.value || "Condition"))),
        ...own.filter(ref => counts(ref, true))
            .map(ref => bonusOf(ref.entry, ref.stacks, linkedLabel(item!, String(ref.source.name?.value ?? "").trim() || "Item"))),
    ];
}

/** What the weapon entries of `field` add to the weapon at `weaponPath`, without the factors. */
export const weaponAdds = (state: SheetSignals, weaponPath: string, field: WeaponField): WeaponAdd[] =>
    weaponBonuses(state, weaponPath, field).filter(isAdd);

/** The factors of the weapon entries of `field` of the weapon at `weaponPath`. */
export const weaponFactors = (state: SheetSignals, weaponPath: string, field: WeaponField): WeaponFactor[] =>
    weaponBonuses(state, weaponPath, field).filter(isFactor);

/** The steps the weapon entries add to the Range of the melee profile at `tabPath`. */
export const rangeBonusSteps = (state: SheetSignals, tabPath: string): RangeStep[] => [
    ...weaponAdds(state, tabPath, "rng").map(b => ({ label: b.label, add: b.add, end: "both" as const })),
    ...weaponAdds(state, tabPath, "rngMin").map(b => ({ label: b.label, add: b.add, end: "min" as const })),
    ...weaponAdds(state, tabPath, "rngMax").map(b => ({ label: b.label, add: b.add, end: "max" as const })),
];

/**
 * The factors of weapon entries on the Range of the melee profile at
 * `tabPath`, which do not count: Distance and Hurling multiply the range of
 * shots and throws, and the books double no reach.
 */
export const meleeRangeFactors = (state: SheetSignals, tabPath: string): WeaponFactor[] =>
    (["rng", "rngMin", "rngMax"] as const).flatMap(field => weaponFactors(state, tabPath, field));

/** The steps the weapon entries add to the Balance of the melee attack at `attackPath`. */
export const balanceBonusSteps = (state: SheetSignals, attackPath: string): Step[] =>
    weaponAdds(state, attackPath, "balance").map(b => ({ label: b.label, add: b.add }));

/** The modifiers the weapon entries add to the damage or penetration of the weapon at `weaponPath`, named by their source. */
export const statBonusMods = (state: SheetSignals, weaponPath: string, stat: "damage" | "pen") =>
    weaponAdds(state, weaponPath, stat === "damage" ? "dmg" : "pen").map(b => ({ expr: signed(b.add), enabled: true, label: b.label }));
