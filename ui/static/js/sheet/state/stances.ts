// The melee stance of the character (rulebook «II. Механика › Бой › Стойки»):
// one for the sheet, meleeAttacks.stance. What the sheet counts of a stance
// are its entries, which buildEntryIndex (state/computed.ts) adds as a
// condition's; the rest is the text on hover. A stance that needs a weapon
// the sheet has none of is only dimmed: the rules warn, the player decides.
import { signal } from "@preact/signals-core";
import type { SheetSignals } from "../schema/sheet";
import type { Entry } from "./computed";
import { idsInOrder } from "./gridOrder";
import { balanceAt, heldGrip } from "./melee";
import { textAt } from "./sync";

export type StanceKey = "standard" | "aggressive" | "defensive" | "covering" | "springy" | "palisade";

export interface Stance {
    key: StanceKey;
    name: string;
    /** What it does, as the rulebook says it, for the title. */
    effect: string;
    /** What it needs of the weapon, as the title says it. */
    needs?: string;
    /** The entries it adds, as a condition's: the fields of each by name. */
    entries: { [field: string]: string }[];
}

export const STANCES: readonly Stance[] = [
    { key: "standard", name: "Standard", effect: "No effect.", entries: [] },
    {
        key: "aggressive", name: "Aggressive",
        effect: "WS +10 (not in opposed tests against a Feint) · Evasion against your melee attacks −10 · you lose 1 Reaction at the end of your turn; with none to lose, melee attacks on you get +20 until your next turn",
        entries: [{ type: "roll_bonus", name: "WS", rollBonus: "10" }],
    },
    {
        key: "defensive", name: "Defensive",
        effect: "No attacks · melee attacks on you −20 · +1 Reaction, for Evasion against melee attacks only · the shield covers its zones in brackets · with a shield, another weapon attacks as a Full Action, no Charge",
        entries: [],
    },
    {
        key: "covering", name: "Covering",
        effect: "Melee attacks on you +20, on your allies in contact with you −20 · a free attack at a foe in contact that attacks an ally (the higher A goes first)",
        entries: [],
    },
    {
        key: "springy", name: "Springy", needs: "a weapon of Balance 0 or more",
        effect: "SPD −2 for movement, +2 for Disengage · Dodge +10 · Parry and S −10",
        entries: [
            { type: "movement_bonus", name: "", movementBonus: "-2" },
            { type: "skill_bonus", name: "Dodge", skillBonus: "10" },
            { type: "skill_bonus", name: "Parry", skillBonus: "-10" },
            { type: "roll_bonus", name: "S", rollBonus: "-10" },
        ],
    },
    {
        key: "palisade", name: "Palisade", needs: "a glaive, spear or bayonet",
        effect: "No Charge or Run · once until your turn, a free attack at a foe with a shorter Rng who attacks you or an ally next to you, before its blow",
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
const SOURCES = new Map(STANCES.map(s => [s.key, { name: signal(`${s.name} stance`) }]));

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
    const tags = [held && held !== grips[0] ? held.id : "", stance.key === "standard" ? "" : stance.name].filter(Boolean);
    return tags.length ? `${name} (${tags.join(", ")})` : name;
}

/** The melee profiles Palisade needs one of. */
const PALISADE_PROFILES = ["glaive", "spear", "bayonet"];

/** Why the sheet cannot take the stance `key`: none of its melee weapons fits; null when one does. */
export function stanceUnavailable(state: SheetSignals, key: StanceKey): string | null {
    const attacks = idsInOrder(state, "meleeAttacks.list.items").map(id => `meleeAttacks.list.items.${id}`);
    if (key === "springy") {
        return attacks.some(a => (balanceAt(state, a).value ?? 0) >= 0) ? null : "No melee weapon of Balance 0 or more, its grip counted";
    }
    if (key === "palisade") {
        const fits = attacks.some(a => idsInOrder(state, `${a}.tabs.items`).some(t => PALISADE_PROFILES.includes(textAt(state, `${a}.tabs.items.${t}.profile`))));
        return fits ? null : "No glaive, spear or bayonet among the melee attacks";
    }
    return null;
}

/** The title of a stance: what it does, what it needs and why the sheet lacks it. */
export function stanceTitle(stance: Stance, unavailable: string | null): string {
    return [stance.effect, stance.needs && `Needs ${stance.needs}`, unavailable].filter(Boolean).join("\n");
}
