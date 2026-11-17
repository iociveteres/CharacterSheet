// The melee stance of the character (rulebook «II. Механика › Бой › Стойки»):
// one for the sheet, meleeAttacks.stance. What the sheet counts of a stance
// are its entries, which buildEntryIndex (kinds/computed.ts) adds as a
// condition's; the rest is the text on hover. A stance that needs a weapon
// the sheet has none of is only dimmed: the rules warn, the player decides.
import { signal } from "@preact/signals-core";
import { t } from "../../i18n";
import type { SheetSignals } from "../schema/sheet";
import type { Entry } from "../modifiers/entries";
import { idsInOrder } from "../core/gridOrder";
import { balanceAt, heldGrip } from "./melee";
import { gripText } from "./gripRules";
import { textAt } from "../core/sync";

export type StanceKey = "standard" | "aggressive" | "defensive" | "covering" | "springy" | "palisade";

export interface Stance {
    key: StanceKey;
    /** Its name in the list of stances, as "Aggressive". */
    name: string;
    /** Its full name, which names its entries, as "Aggressive Stance". */
    source: string;
    /** What it does, as the rulebook says it, for the title. */
    effect: string;
    /** The line of the title that says what it needs of the weapon. */
    needs?: string;
    /** The entries it adds, as a condition's: the fields of each by name. */
    entries: { [field: string]: string }[];
}

// Names and texts in the page's language; the stance is stored by its key and
// its entries name the skills and characteristics in English, as the sheet stores them.
export const STANCES: readonly Stance[] = [
    { key: "standard", name: t("sheet.termsArms.stance.standard.short"), source: t("sheet.termsArms.stance.standard"), effect: t("sheet.weapons.stanceEffect.standard"), entries: [] },
    {
        key: "aggressive", name: t("sheet.termsArms.stance.aggressive.short"), source: t("sheet.termsArms.stance.aggressive"),
        effect: t("sheet.weapons.stanceEffect.aggressive"),
        entries: [{ type: "roll_bonus", name: "WS", rollBonus: "10" }],
    },
    {
        key: "defensive", name: t("sheet.termsArms.stance.defensive.short"), source: t("sheet.termsArms.stance.defensive"),
        effect: t("sheet.weapons.stanceEffect.defensive"),
        entries: [],
    },
    {
        key: "covering", name: t("sheet.termsArms.stance.covering.short"), source: t("sheet.termsArms.stance.covering"),
        effect: t("sheet.weapons.stanceEffect.covering"),
        entries: [],
    },
    {
        key: "springy", name: t("sheet.termsArms.stance.springy.short"), source: t("sheet.termsArms.stance.springy"),
        needs: t("sheet.weapons.stanceNeeds.springy"),
        effect: t("sheet.weapons.stanceEffect.springy"),
        entries: [
            { type: "movement_bonus", name: "", movementBonus: "-2" },
            { type: "skill_bonus", name: "Dodge", skillBonus: "10" },
            { type: "skill_bonus", name: "Parry", skillBonus: "-10" },
            { type: "roll_bonus", name: "S", rollBonus: "-10" },
        ],
    },
    {
        key: "palisade", name: t("sheet.termsArms.stance.palisade"), source: t("sheet.termsArms.stance.palisade"),
        needs: t("sheet.weapons.stanceNeeds.palisade"),
        effect: t("sheet.weapons.stanceEffect.palisade"),
        entries: [],
    },
];

const BY_KEY = new Map(STANCES.map(s => [s.key, s]));

/** The stance of the sheet: Standard for none or one it does not know. */
export const stanceOf = (state: SheetSignals): Stance => BY_KEY.get(textAt(state, "meleeAttacks.stance") as StanceKey) ?? STANCES[0];

/** What meleeAttacks.stance stores for the stance `key`: none for Standard. */
export const storedStance = (key: StanceKey) => (key === "standard" ? "" : key);

// The entries of each stance as a condition's signals: they never change.
const ENTRIES = new Map(STANCES.map(s => [s.key, s.entries.map(fields =>
    Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, signal(v)])) as unknown as Entry)]));

/** The source the entries of a stance count from, as a condition is. */
const SOURCES = new Map(STANCES.map(s => [s.key, { name: signal(s.source) }]));

/** The entries the stance of the sheet adds, with the source to name them by. */
export function stanceEntries(state: SheetSignals) {
    const { key } = stanceOf(state);
    return { entries: ENTRIES.get(key)!, source: SOURCES.get(key)! };
}

/**
 * The name of the rolls of the melee attack at `attackPath`: with its grip
 * when not the primary and the stance when not Standard, as
 * "Longsword (1h, Aggressive)".
 */
export function meleeRollName(state: SheetSignals, attackPath: string, name: string): string {
    const { grips, held } = heldGrip(state, attackPath);
    const stance = stanceOf(state);
    const tags = [held && held !== grips[0] ? gripText(held) : "", stance.key === "standard" ? "" : stance.name].filter(Boolean);
    return tags.length ? `${name} (${tags.join(", ")})` : name;
}

/** The melee profiles Palisade needs one of. */
const PALISADE_PROFILES = ["glaive", "spear", "bayonet"];

/** Why the sheet cannot take the stance `key`: none of its melee weapons fits; null when one does. */
export function stanceUnavailable(state: SheetSignals, key: StanceKey): string | null {
    const attacks = idsInOrder(state, "meleeAttacks.list.items").map(id => `meleeAttacks.list.items.${id}`);
    if (key === "springy") {
        return attacks.some(a => (balanceAt(state, a).value ?? 0) >= 0) ? null : t("sheet.weapons.stanceUnavailable.springy");
    }
    if (key === "palisade") {
        const fits = attacks.some(a => idsInOrder(state, `${a}.tabs.items`).some(tab => PALISADE_PROFILES.includes(textAt(state, `${a}.tabs.items.${tab}.profile`))));
        return fits ? null : t("sheet.weapons.stanceUnavailable.palisade");
    }
    return null;
}

/** The title of a stance: what it does, what it needs and why the sheet lacks it. */
export function stanceTitle(stance: Stance, unavailable: string | null): string {
    return [stance.effect, stance.needs, unavailable].filter(Boolean).join("\n");
}
