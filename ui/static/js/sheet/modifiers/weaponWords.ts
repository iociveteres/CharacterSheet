// The words a weapon entry (weapons/weaponBonus.ts) names weapons by: Melee or
// Ranged, a melee group or ranged class, a melee profile, the name of a weapon
// of the sheet, and "This item" inside a gear item.
import { MELEE_GROUPS, MELEE_PROFILES, RANGED_CLASSES, optionValue, type Option } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { idsInOrder } from "../core/gridOrder";
import { textAt } from "../core/sync";
import { sheetComputed } from "../core/state";
import type { Entry } from "./entries";
import { t } from "../../i18n";

/** The words that name all the weapons of a kind. */
export const WEAPON_KINDS: readonly Option[] = [
    { value: "melee", label: t("sheet.termsArms.weaponKind.melee") },
    { value: "ranged", label: t("sheet.termsArms.weaponKind.ranged") },
];

/** The melee groups and ranged classes, named as their selects show them. */
export const WEAPON_GROUPS: readonly Option[] = [...MELEE_GROUPS, ...RANGED_CLASSES];

/** The melee profiles, but Other and none. */
export const WEAPON_PROFILES: readonly Option[] = MELEE_PROFILES.filter(o => optionValue(o) !== "" && optionValue(o) !== "no");

const lower = (s: string) => s.trim().toLowerCase();
// Values only: the labels are in the page's language, and the sheet must read the same for every viewer.
const KNOWN = new Set([...WEAPON_KINDS, ...WEAPON_GROUPS, ...WEAPON_PROFILES].map(o => lower(String(optionValue(o)))));

/** The words of an entry's name, separated by commas. */
export const weaponWords = (name: string): string[] => name.split(",").map(lower).filter(Boolean);

/** The word of an entry inside a gear item that names the attacks linked to the item; English in every language, as the other words. */
export const THIS_ITEM = "This item";
const THIS_ITEM_WORD = lower(THIS_ITEM);

/** Whether the weapon entry names the attacks linked to its item. */
export const namesThisItem = (entry: Entry) => weaponWords(String(entry.name?.value ?? "")).includes(THIS_ITEM_WORD);

/** The names of the weapons of the sheet, melee then ranged. */
export function weaponNames(state: SheetSignals): string[] {
    const names = ["meleeAttacks", "rangedAttacks"].flatMap(block =>
        idsInOrder(state, `${block}.list.items`).map(id => textAt(state, `${block}.list.items.${id}.name`).trim()));
    return [...new Set(names.filter(Boolean))];
}

/**
 * The names of weaponNames in lower case, one set per sheet: each weapon
 * entry of each weapon checks its words against them, and a rename of the
 * item the entry is in wakes them all.
 */
const namesInLowerCase = sheetComputed(state => new Set(weaponNames(state).map(lower)),
    (a, b) => a.size === b.size && [...a].every(n => b.has(n)));

/** The words of `name` that name no weapon of the sheet nor anything a weapon is; "This item" is known `inItem`, in an entry of a gear item. */
export function unknownWeaponWords(state: SheetSignals, name: string, inItem = false): string[] {
    const names = namesInLowerCase(state);
    return weaponWords(name).filter(w => !KNOWN.has(w) && !names.has(w) && !(inItem && w === THIS_ITEM_WORD));
}
