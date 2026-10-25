// Weapon entries of conditions, gear and implants (type weapon_bonus): what a
// condition adds to a field of some weapons, as a power of Pathfinder Crusade
// lengthening the reach. The name says which weapons, words separated by
// commas: Melee or Ranged, a melee group or ranged class, a melee profile or
// the name of a weapon of the sheet. An unknown word turns the entry off, as
// an unknown characteristic does a Roll Bonus.
import { MELEE_GROUPS, MELEE_PROFILES, RANGED_CLASSES, optionLabel, optionValue, type Option } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { resolveStackExpr, signed } from "../system";
import { collectEntries } from "./computed";
import { idsInOrder } from "./gridOrder";
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

/** The names of the weapons of the sheet, melee then ranged. */
export function weaponNames(state: SheetSignals): string[] {
    const names = ["meleeAttacks", "rangedAttacks"].flatMap(block =>
        idsInOrder(state, `${block}.list.items`).map(id => textAt(state, `${block}.list.items.${id}.name`).trim()));
    return [...new Set(names.filter(Boolean))];
}

/** The words of `name` that name no weapon of the sheet nor anything a weapon is. */
export function unknownWeaponWords(state: SheetSignals, name: string): string[] {
    const names = new Set(weaponNames(state).map(lower));
    return weaponWords(name).filter(w => !KNOWN.has(w) && !names.has(w));
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

/** A weapon entry that counts for the weapon: what it adds and the source to name it by. */
export interface WeaponBonus {
    add: number;
    label: string;
}

/** What the weapon entries of `field` add to the weapon at `weaponPath`: a melee attack, one of its profile tabs or a ranged attack. */
export function weaponBonuses(state: SheetSignals, weaponPath: string, field: WeaponField): WeaponBonus[] {
    const entries = collectEntries(state, "weapon_bonus", e => (e.weaponField?.value || "rng") === field);
    if (!entries.length) return [];
    const is = weaponIs(state, weaponPath);
    return entries.flatMap(({ entry, stacks, source }) => {
        const words = weaponWords(String(entry.name?.value ?? ""));
        if (!words.length || unknownWeaponWords(state, String(entry.name?.value ?? "")).length) return [];
        if (!words.some(w => names(w, is))) return [];
        return [{ add: resolveStackExpr(entry.weaponBonus?.value, stacks), label: String(source.name?.value || "Condition") }];
    });
}

/** The steps the weapon entries add to the Range of the melee profile at `tabPath`. */
export const rangeBonusSteps = (state: SheetSignals, tabPath: string): RangeStep[] => [
    ...weaponBonuses(state, tabPath, "rng").map(b => ({ label: b.label, add: b.add, end: "both" as const })),
    ...weaponBonuses(state, tabPath, "rngMin").map(b => ({ label: b.label, add: b.add, end: "min" as const })),
    ...weaponBonuses(state, tabPath, "rngMax").map(b => ({ label: b.label, add: b.add, end: "max" as const })),
];

/** The steps the weapon entries add to the Balance of the melee attack at `attackPath`. */
export const balanceBonusSteps = (state: SheetSignals, attackPath: string): Step[] =>
    weaponBonuses(state, attackPath, "balance").map(b => ({ label: b.label, add: b.add }));

/** The modifiers the weapon entries add to the damage or penetration of the weapon at `weaponPath`, named by their source. */
export const statBonusMods = (state: SheetSignals, weaponPath: string, stat: "damage" | "pen") =>
    weaponBonuses(state, weaponPath, stat === "damage" ? "dmg" : "pen").map(b => ({ expr: signed(b.add), enabled: true, label: b.label }));
