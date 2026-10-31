// The Reload of a ranged attack with what changes it (blocks/Attacks.tsx),
// counted in half-actions. Pathfinder Crusade's table writes half-actions, ½
// for one; Black Crusade's writes actions, ½ a half one and 1 a full one
// (StatSet.reloadUnit). The weapon entries of the field Reload change it in
// three steps (wiki «iv арсенал › зачарования › дальнобойное оружие», Quick
// Loading; «iii продвижение › таланты › скорость», Rapid Reload):
//   1. the enchantments of the linked item, "This item": before the others;
//   2. the other entries that add, as a siege mage's −PR;
//   3. the other factors, rounded down: the talent Rapid Reload of the
//      talents list, ×½ for every weapon, as Expanded Sustain counts.
// The first two never take it below 1 half-action, the factors can: a
// weapon reloaded with a half-action is reloaded as a free action.
import type { SheetSignals } from "../schema/sheet";
import { signed } from "../system";
import { talentNames } from "./arts";
import { nameKey } from "./magicTest";
import type { BreakdownLine } from "./melee";
import { textAt } from "./sync";
import { weaponBonuses, type WeaponBonus } from "./weaponBonus";

/** How many half-actions a Reload of 1 takes: 1 in Pathfinder Crusade, 2 in Black Crusade. */
export type ReloadUnit = 1 | 2;

/** What a total of no half-actions reads as. */
export const FREE = "Free";

// "2", "½", "1½": whole units and a half-action.
const RELOAD = /^(\d+)?\s*(½)?$/;

/** The half-actions the Reload `text` takes; null when it reads as no number, as "1 [2]" or "†". */
export function readReload(text: string, unit: ReloadUnit): number | null {
    const m = text.trim().match(RELOAD);
    if (!m || (!m[1] && !m[2])) return null;
    return (m[1] ? parseInt(m[1], 10) * unit : 0) + (m[2] ? 1 : 0);
}

/** The Reload `halves` half-actions take, as the table of the kind writes it. */
export function reloadText(halves: number, unit: ReloadUnit): string {
    if (halves <= 0) return FREE;
    if (unit === 1) return String(halves);
    const whole = Math.floor(halves / 2);
    return `${whole || ""}${halves % 2 ? "½" : ""}`;
}

export interface Reload {
    /** The weapon's own Reload as typed. */
    base: string;
    lines: BreakdownLine[];
    /** The half-actions it takes; null when the base reads as no number, and then the entries do not count. */
    halves: number | null;
    /** What the row shows: the total, or the base as typed. */
    text: string;
}

const RAPID_RELOAD = ["rapid reload", "быстрая перезарядка"];

const factorText = (b: { factor: number; roundUp: boolean }) => `×${b.factor === 0.5 ? "½" : b.factor}${b.roundUp ? "▲" : ""}`;

/** `value` rounded down, or up with `up`, after the float noise of the multiplication. */
const round = (value: number, up: boolean) => {
    const clean = Math.round(value * 1e6) / 1e6;
    return up ? Math.ceil(clean) : Math.floor(clean);
};

/** The Reload of the ranged attack at `path`. */
export function reloadAt(state: SheetSignals, path: string, unit: ReloadUnit): Reload {
    const base = textAt(state, `${path}.reload`).trim();
    const own = readReload(base, unit);
    if (own === null) return { base, lines: [], halves: null, text: base };

    const rapid = talentNames(state).find(name => RAPID_RELOAD.includes(nameKey(name)));
    const bonuses: WeaponBonus[] = [
        ...weaponBonuses(state, path, "reload"),
        ...(rapid ? [{ factor: 0.5, roundUp: false, label: rapid }] : []),
    ];
    const lines: BreakdownLine[] = [];
    let halves = own;
    const apply = (b: WeaponBonus, floored: boolean) => {
        const before = halves;
        halves = "add" in b ? halves + b.add : round(halves * b.factor, b.roundUp);
        // An enchantment or a −1 speeds up to a half-action, not past it.
        if (floored) halves = Math.max(halves, Math.min(before, 1));
        lines.push({ text: "add" in b ? signed(b.add) : factorText(b), label: b.label });
    };
    const adds = (b: WeaponBonus) => "add" in b;
    for (const b of bonuses.filter(b => b.ofItem && adds(b))) apply(b, true);
    for (const b of bonuses.filter(b => b.ofItem && !adds(b))) apply(b, true);
    for (const b of bonuses.filter(b => !b.ofItem && adds(b))) apply(b, true);
    for (const b of bonuses.filter(b => !b.ofItem && !adds(b))) apply(b, false);
    return { base, lines, halves, text: reloadText(halves, unit) };
}
