// Weapon entries of conditions, gear and implants (type weapon_bonus): what a
// condition adds to a field of some weapons, as a power of Pathfinder Crusade
// lengthening the reach. The name says which weapons, words separated by
// commas: Melee or Ranged, a melee group or ranged class, a melee profile or
// the name of a weapon of the sheet (modifiers/weaponWords.ts). An unknown word
// turns the entry off, as an unknown characteristic does a Roll Bonus. Inside
// a gear item "This item" names the attacks linked to the item
// (gear/itemLinkRules.ts): such an entry counts for them whether or not the
// item is equipped, and nowhere else. A value "×2" multiplies the range of a
// ranged attack (Distance, Hurling). Dmg and Pen also take a damage
// expression, "½WS.b▲" or "1d10", as the modifiers of the weapon do. Hit adds
// to the attack rolls of the weapon, Parry to its Parry (weapons/parry.ts).
// The Quality of the linked item adds as an entry of the item would
// (gear/quality.ts).
import { t } from "../../i18n";
import { readMultiplier } from "../rolls/damageExpression";
import { optionValue, type Option } from "../schema/constants";
import { WEAPON_GROUPS, WEAPON_PROFILES, namesThisItem, unknownWeaponWords, weaponWords } from "../modifiers/weaponWords";
import type { SheetSignals } from "../schema/sheet";
import { isStackExpr, resolveStackExpr } from "../modifiers/entryValues";
import { signed } from "../components/format";
import { collectEntries, type Entry, type EntryRef } from "../modifiers/entries";
import { gearItemEntries } from "../gear/gearItem";
import type { GearItem } from "../schema/sheet";
import { idsInOrder } from "../core/gridOrder";
import { linkedItem, linkedLabel, linkedPart } from "../gear/itemLinkRules";
import { code, SPACE, SRC, type Part } from "../rollLabel";
import { qualityAdds } from "../gear/quality";
import type { RangeStep, Step } from "./gripRules";
import { textAt } from "../core/sync";

export type WeaponField = "rng" | "rngMax" | "rngMin" | "balance" | "dmg" | "pen" | "reload" | "hit" | "parry";

const lower = (s: string) => s.trim().toLowerCase();

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
        profiles: melee ? tabs.map(tab => lower(textAt(state, `${tab}.profile`))) : [],
    };
}

/** Whether `word` names the weapon `is`: its kind, group or class, a profile or its name. */
function names(word: string, is: WeaponIs): boolean {
    if (word === is.kind || (is.name && word === is.name)) return true;
    // By value, not label: the label is in the page's language.
    const option = (list: readonly Option[], value: string) => word === value && list.some(o => lower(String(optionValue(o))) === value);
    return (is.group !== "" && option(WEAPON_GROUPS, is.group)) || is.profiles.some(p => option(WEAPON_PROFILES, p));
}

/** A weapon entry that adds to the weapon, and the source to name it by. */
export interface WeaponAdd {
    add: number;
    /** The value as typed when it is no number nor stack expression, as "½WS.b▲": Dmg and Pen count it as a damage modifier. */
    expr?: string;
    label: string;
    /** The label in a roll's label: what of it the sheet names goes in as codes. */
    part: Part;
    /** An entry of the linked item that names "This item", as an enchantment of the weapon. */
    ofItem?: boolean;
}

/** A weapon entry that multiplies the field, rounded down unless `roundUp`. */
export interface WeaponFactor {
    factor: number;
    roundUp: boolean;
    label: string;
    part: Part;
    ofItem?: boolean;
}

/** A weapon entry that counts for the weapon. */
export type WeaponBonus = WeaponAdd | WeaponFactor;

const isAdd = (b: WeaponBonus): b is WeaponAdd => "add" in b;
const isFactor = (b: WeaponBonus): b is WeaponFactor => "factor" in b;

/** What the value of `entry` does at `stacks`: "×2" multiplies, anything else adds as the stacks resolve it. */
function bonusOf(entry: Entry, stacks: number, label: string, part: Part): WeaponBonus {
    const value = String(entry.weaponBonus?.value ?? "");
    const factor = readMultiplier(value);
    if (factor) return { ...factor, label, part };
    const add = resolveStackExpr(value, stacks);
    return isStackExpr(value) ? { add, label, part } : { add, expr: value.trim(), label, part };
}

/** The source of a condition's, implant's or stance's entry: its name, the code of a stance's, "Condition" without one. */
function sourceOf(ref: EntryRef): { label: string; part: Part } {
    const name = String(ref.source.name?.value ?? "");
    return { label: name || t("sheet.weapons.condition"), part: ref.source.labelPart ?? (name || code(SPACE.src, SRC.condition)) };
}

/** The source of an entry of the linked `item`: its name, "Item" without one; and the item, unless it is the source. */
function itemSourceOf(ref: EntryRef, item: GearItem): { label: string; part: Part } {
    const name = String(ref.source.name?.value ?? "").trim();
    return { label: linkedLabel(item, name || t("sheet.gear.item")), part: linkedPart(item, name || code(SPACE.src, SRC.item)) };
}

const ofField = (field: WeaponField) => (e: Entry) => (e.weaponField?.value || "rng") === field;

/**
 * What the weapon entries of `field` do to the weapon at `weaponPath`: a
 * melee attack, one of its profile tabs or a ranged attack. The entries of
 * conditions, implants and equipped gear by the words of their names; those
 * of the linked item that name "This item", equipped or not, and its Quality.
 */
export function weaponBonuses(state: SheetSignals, weaponPath: string, field: WeaponField): WeaponBonus[] {
    // An item's entry naming "This item" counts only through the link, below.
    const entries = collectEntries(state, "weapon_bonus", ofField(field)).filter(ref => !(ref.item && namesThisItem(ref.entry)));
    const item = linkedItem(state, weaponPath);
    const own = item
        ? gearItemEntries(item).filter(ref => ref.entry.type?.value === "weapon_bonus" && ofField(field)(ref.entry) && namesThisItem(ref.entry))
        : [];
    const quality = qualityAdds(state, weaponPath, field).map(q => ({ ...q, ofItem: true }));
    if (!entries.length && !own.length) return quality;
    const is = weaponIs(state, weaponPath);
    const counts = (ref: EntryRef, inItem: boolean) => {
        const name = String(ref.entry.name?.value ?? "");
        return !unknownWeaponWords(state, name, inItem).length && (inItem || weaponWords(name).some(w => names(w, is)));
    };
    return [
        ...entries.filter(ref => counts(ref, false)).map(ref => {
            const source = sourceOf(ref);
            return bonusOf(ref.entry, ref.stacks, source.label, source.part);
        }),
        ...own.filter(ref => counts(ref, true)).map(ref => {
            const source = itemSourceOf(ref, item!);
            return { ...bonusOf(ref.entry, ref.stacks, source.label, source.part), ofItem: true };
        }),
        ...quality,
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

/** A line of a roll's label that adds to the roll: `label` for the title, `part` for the label. */
export interface HitLine {
    label: string;
    part: Part;
    add: number;
}

/**
 * What the weapon entries add to the attack rolls of the weapon at
 * `weaponPath`, a melee profile tab or a ranged attack, each named with its
 * value for the roll's label.
 */
export const hitLines = (state: SheetSignals, weaponPath: string): HitLine[] =>
    weaponAdds(state, weaponPath, "hit").map(b => ({
        label: `${b.label} ${signed(b.add)}`,
        // Text alone stays text: there is nothing in it for the reader to word.
        part: typeof b.part === "string" ? `${b.part} ${signed(b.add)}` : code(SPACE.hit, null, { s: b.part, n: b.add }),
        add: b.add,
    }));

/** The steps the weapon entries add to the Balance of the melee attack at `attackPath`. */
export const balanceBonusSteps = (state: SheetSignals, attackPath: string): Step[] =>
    weaponAdds(state, attackPath, "balance").map(b => ({ label: b.label, add: b.add }));

/**
 * The modifiers the weapon entries add to the damage or penetration of the
 * weapon at `weaponPath`, named by their source: a number, or the value as
 * typed, which the damage parser reads with its references ("½WS.b▲").
 */
export const statBonusMods = (state: SheetSignals, weaponPath: string, stat: "damage" | "pen") =>
    weaponAdds(state, weaponPath, stat === "damage" ? "dmg" : "pen").map(b => ({ expr: b.expr ?? signed(b.add), enabled: true, label: b.label }));
