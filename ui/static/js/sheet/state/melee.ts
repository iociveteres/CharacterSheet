// What a melee weapon's grip (state/grips.ts) does to its Range, Balance,
// damage and attacks. Steps apply in the rulebook's order: additions, then
// the values a grip sets ("Balance = −2"), then the limits: Balance from −2
// to 2, Rng not below 0. Reactive when read inside a computed.
import { parseDamage } from "../damage";
import { signed } from "../system";
import type { SheetSignals } from "../schema/sheet";
import { MACE_PROFILE, gripEffects, parseGrips, type GripEffects, type Grip, type Step } from "./grips";
import { idsInOrder } from "./gridOrder";
import { textAt } from "./sync";

/** The melee attack a profile tab at `tabPath` belongs to. */
export const attackOfTab = (tabPath: string) => tabPath.replace(/\.tabs\.items\.[^.]+$/, "");

const NO_EFFECTS: GripEffects = { range: [], balance: [], damage: [], halfStrength: false, ws: [], properties: [], profiles: null, mace: false };

export interface HeldGrip {
    /** The grips of the weapon's string, the primary first. */
    grips: Grip[];
    /** The grip held: the one selected, or the primary while none or a gone one is; null without grips. */
    held: Grip | null;
    effects: GripEffects;
}

/** Whether the melee attack at `attackPath` is a spear: one of its profiles is. */
const isSpear = (state: SheetSignals, attackPath: string) =>
    idsInOrder(state, `${attackPath}.tabs.items`).some(id => textAt(state, `${attackPath}.tabs.items.${id}.profile`) === "spear");

/** The grip the melee attack at `attackPath` is held in and what it changes. */
export function heldGrip(state: SheetSignals, attackPath: string): HeldGrip {
    const grips = parseGrips(textAt(state, `${attackPath}.grip`));
    const selected = textAt(state, `${attackPath}.gripSelected`);
    const held = grips.find(g => g.id === selected) ?? grips[0] ?? null;
    return { grips, held, effects: held ? gripEffects(held, grips[0], isSpear(state, attackPath)) : NO_EFFECTS };
}

/** A line of a breakdown: what changed the value and how, as "+1" and "1h". */
export interface BreakdownLine {
    text: string;
    label: string;
}

const stepText = (step: Step) => ("add" in step ? signed(step.add) : `= ${step.set}`);

/** `steps` in the order they apply: the additions, then the values set. */
const inOrder = <S extends Step>(steps: readonly S[]) => [...steps.filter(s => "add" in s), ...steps.filter(s => "set" in s)];

/** `value` after `steps`. */
function applySteps(value: number, steps: readonly Step[]): number {
    for (const step of steps) if ("add" in step) value += step.add;
    for (const step of steps) if ("set" in step) value = step.set;
    return value;
}

// ─── Range ───────────────────────────────────────────────────────────────────

// "2-4" or "3"; the rulebooks' dashes too.
const RANGE = /^(\d+)\s*(?:[-–—−]\s*(\d+))?$/;

export interface MeleeRange {
    /** The weapon's own range, or the Mace's in Mordhau. */
    base: string;
    /** Whose range the base is: "Weapon" or "Mace". */
    own: string;
    lines: BreakdownLine[];
    /** What the row shows: "2-4", "3", or the base as typed when it reads as no range. */
    text: string;
}

const rangeText = (min: number, max: number) => (min === max ? String(min) : `${min}-${max}`);

/** The range of the melee profile at `tabPath`, its grip applied. */
export function meleeRangeAt(state: SheetSignals, tabPath: string): MeleeRange {
    const { effects } = heldGrip(state, attackOfTab(tabPath));
    const base = effects.mace ? MACE_PROFILE.range : textAt(state, `${tabPath}.range`).trim();
    const own = effects.mace ? "Mace" : "Weapon";
    const m = base.match(RANGE);
    if (!m) return { base, own, lines: [], text: base };

    const steps = effects.range;
    const lines = inOrder(steps).map(s => ({ text: s.end === "both" ? stepText(s) : `${stepText(s)} ${s.end}`, label: s.label }));
    const along = (end: "min" | "max") => steps.filter(s => s.end === "both" || s.end === end);
    let min = applySteps(Number(m[1]), along("min"));
    let max = applySteps(Number(m[2] ?? m[1]), along("max"));
    if (min < 0 || max < 0) lines.push({ text: "≥ 0", label: "Rng limit" });
    min = Math.max(0, min);
    max = Math.max(min, max);
    return { base, own, lines, text: steps.length ? rangeText(min, max) : base };
}

// ─── Balance ─────────────────────────────────────────────────────────────────

const BALANCE = /^[+\-–−]?\d+$/;

export interface Balance {
    base: string;
    own: string;
    lines: BreakdownLine[];
    /** The Balance that counts; 0 for a weapon without one, as a shield; null when it reads as no number. */
    value: number | null;
    /** What the row shows: the total, or the base as typed without changes. */
    text: string;
}

/** The Balance of the melee attack at `attackPath`, its grip applied, from −2 to 2. */
export function balanceAt(state: SheetSignals, attackPath: string): Balance {
    const { effects } = heldGrip(state, attackPath);
    const typed = textAt(state, `${attackPath}.balance`).trim();
    const base = effects.mace ? String(MACE_PROFILE.balance) : typed;
    const own = effects.mace ? "Mace" : "Weapon";
    const steps = effects.balance;
    if (base && !BALANCE.test(base)) return { base, own, lines: [], value: null, text: base };

    const lines = inOrder(steps).map(s => ({ text: stepText(s), label: s.label }));
    const raw = applySteps(base ? Number(base.replace(/[–−]/, "-")) : 0, steps);
    const value = Math.min(2, Math.max(-2, raw));
    if (value !== raw) lines.push({ text: raw > 2 ? "≤ 2" : "≥ -2", label: "Balance limit" });
    return { base, own, lines, value, text: base || lines.length ? String(value) : "" };
}

// ─── Attacks, damage and properties ──────────────────────────────────────────

/** What the grip of the melee attack at `attackPath` gives its WS tests. */
export const gripWS = (state: SheetSignals, attackPath: string) =>
    heldGrip(state, attackPath).effects.ws.reduce((sum, { add }) => sum + add, 0);

/** The properties the grip gives the melee profile at `tabPath` that its Special does not name yet. */
export function gripProperties(state: SheetSignals, tabPath: string): string[] {
    const { effects } = heldGrip(state, attackOfTab(tabPath));
    const special = (effects.mace ? MACE_PROFILE.special : textAt(state, `${tabPath}.special`)).toLowerCase();
    return effects.properties.filter(p => !special.includes(p.toLowerCase()));
}

/** A modifier of damage or penetration, as damage.ts WeaponMod, named by what it comes from. */
export interface GripMod {
    expr: string;
    enabled: boolean;
    label?: string;
}

const STRENGTH = /^S\.b$/i;

/**
 * The base and modifiers of the damage or penetration of the melee profile at
 * `tabPath` as its grip changes them: Mordhau uses the Mace's base; Rev
 * halves the S.b modifiers; 1h takes a die of the base away (−4 with one), 2h
 * adds +3. `keys` are the characteristics references name.
 */
export function gripStat(state: SheetSignals, tabPath: string, stat: "damage" | "pen", own: string, mods: GripMod[], keys: readonly string[]) {
    const { effects } = heldGrip(state, attackOfTab(tabPath));
    const base = effects.mace ? MACE_PROFILE[stat] : own;
    if (stat === "pen") return { base, own: effects.mace ? "Mace" : null, mods };

    const halved = effects.halfStrength
        ? mods.map(mod => (mod.enabled && STRENGTH.test(mod.expr.replace(/\s+/g, "")) ? { ...mod, expr: "½S.b▲", label: "½S.b▲ (Rev)" } : mod))
        : mods;
    const added = effects.damage.map(({ label, expr }) => ({ expr: expr === "die" ? lessDie(base.split("[")[0], keys) : expr, enabled: true, label }));
    return { base, own: effects.mace ? "Mace" : null, mods: [...halved, ...added] };
}

/** What losing a die takes from the damage `base`: a die of its first sides, or 4 when it has one die or none. */
function lessDie(base: string, keys: readonly string[]): string {
    let first = 0;
    let count = 0;
    for (const term of parseDamage(base, keys).terms) {
        if (term.kind !== "dice" || term.count <= 0) continue;
        first ||= term.sides;
        count += term.count;
    }
    return count > 1 ? `-1d${first}` : "-4";
}

/** Whether the Special `special` names the property `name`, as "Defensive" in "Defensive, Primitive". */
export const hasProperty = (special: string, name: string) =>
    special.split(/[,;]/).some(part => part.trim().toLowerCase().replace(/\s*\(.*\)$/, "") === name.toLowerCase());

/** Whether a profile of the melee attack at `attackPath` has the property `name`. */
export const attackHasProperty = (state: SheetSignals, attackPath: string, name: string) =>
    idsInOrder(state, `${attackPath}.tabs.items`).some(id => hasProperty(textAt(state, `${attackPath}.tabs.items.${id}.special`), name));

/** What the attacks of the melee attack at `attackPath` get besides their roll's columns: the grip's WS, −10 of Defensive. */
export const meleeAttackBonus = (state: SheetSignals, attackPath: string) =>
    gripWS(state, attackPath) - (attackHasProperty(state, attackPath, "Defensive") ? 10 : 0);
