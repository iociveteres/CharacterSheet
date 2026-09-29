// The damage and penetration of a weapon, psychic or tech power with their
// modifiers (damage.ts), as the character's state gives the references their
// values. Reactive when read inside a computed.
import { nanoid } from "nanoid";
import {
    BASE_PR, POWER_PR, POWER_REFS, WEAPON_REFS, addTerms, addedBy, emptySum, formatSum, parseDamage, resolveDamage,
    type ResolvedDamage, type WeaponMod,
} from "../damage";
import { characteristicBonus } from "./characteristics";
import { characterState } from "./state";
import { idsInOrder } from "./gridOrder";
import { castCap, psychicPowers } from "./psychic";
import { numberAt, textAt, valueAt } from "./sync";

/** A characteristic's bonus, or the base psy rating. */
export function refValue(ref: string): number {
    return ref === BASE_PR ? numberAt("psykana.basePR") : characteristicBonus(ref);
}

/** The characteristics a reference can name: those of the open sheet. */
export const refKeys = (): string[] => Object.keys(characterState.characteristics ?? {});

/** The PR the damage of the power at `powerPath` counts: its last cast's, the PR of a normal cast before one. */
export function powerPR(powerPath: string): number {
    const pr = numberAt(`${powerPath}.cast.pr`);
    return pr > 0 ? pr : castCap(powerPath);
}

/** The references the damage of an item can hold, as parseDamage and resolveDamage take them. */
export interface DamageRefs {
    keys: readonly string[];
    named: readonly string[];
    valueOf: (ref: string) => number;
}

/** A value of a weapon or power that takes modifiers: its own in `stat`, the modifiers in `${stat}Mods`. */
export type WeaponStat = "damage" | "pen";

/** The modifiers of `stat` of the attack or melee profile at `itemPath`, in the order of their grid. */
export function modsAt(itemPath: string, stat: WeaponStat): WeaponMod[] {
    const grid = `${itemPath}.${stat}Mods.items`;
    return idsInOrder(grid).map(id => ({ expr: textAt(`${grid}.${id}.expr`), enabled: !!valueAt(`${grid}.${id}.enabled`) }));
}

/** A damage or penetration as the sheet shows and rolls it. */
export interface StatText {
    /** What a roll sends: the damage with the modifiers, or the text as typed when it is no expression. */
    expression: string;
    /** The damage as shown: the expression and its alternative in brackets, as "1d10+6 [1d10+9]". */
    text: string;
    /** What each counted modifier adds, as "S.b +4" or "+1d10" for one without references. */
    parts: string[];
    /** Whether the base reads as an expression; only then do the modifiers count. */
    parsed: boolean;
}

/** How `resolved` shows: modifiers with references are named by their expression. */
export function statText({ typed, sum, alt, mods }: ResolvedDamage): StatText {
    if (!sum) return { expression: typed, text: typed, parts: [], parsed: false };
    const expression = formatSum(sum);
    const text = alt === undefined ? expression : `${expression} [${typeof alt === "string" ? alt : formatSum(alt)}]`;
    const parts = mods.map(({ expr, terms, added }) =>
        (terms.some(t => t.kind === "ref" || t.kind === "refDice") ? `${expr} ${addedBy(added)}` : addedBy(added)));
    return { expression, text, parts, parsed: true };
}

/** `stat` of the item of `owner` at `itemPath` with its modifiers. */
export function statAt(owner: DamageOwner, itemPath: string, stat: WeaponStat): StatText {
    const { keys, named, valueOf } = owner.refs(itemPath);
    return statText(resolveDamage(textAt(`${itemPath}.${stat}`), modsAt(itemPath, stat), keys, valueOf, named));
}

/** What the modifier `expr` adds to the item of `owner` at `itemPath`, as "+4"; "—" while it reads as nothing. */
export function modAddedAt(owner: DamageOwner, itemPath: string, expr: string): string {
    const { keys, named, valueOf } = owner.refs(itemPath);
    const { terms, invalid } = parseDamage(expr, keys, named);
    return invalid.length || terms.length === 0 ? "—" : addedBy(addTerms(emptySum(), terms, valueOf));
}

/**
 * The Strength bonus that melee adds to damage: a new melee profile has it,
 * as internal/gamedata/melee.go gives the profiles picked from the collection.
 */
export const STRENGTH_BONUS: WeaponMod = { expr: "S.b", enabled: true };

/** A grid of `mods` of `stat` under new ids, as a new item holds them. */
export function modsGrid(mods: readonly WeaponMod[], stat: WeaponStat) {
    const ids = mods.map(() => `${stat}-mod-${nanoid()}`);
    return {
        items: Object.fromEntries(mods.map(({ expr, enabled }, i) => [ids[i], { expr, enabled }])),
        layouts: Object.fromEntries(ids.map((id, i) => [id, { colIndex: 0, rowIndex: i }])),
    };
}

/** The label of a melee profile's rolls: the weapon, and the profile unless it is none. */
export const profileLabel = (weapon: string, profile: string) => (profile && profile !== "no" ? `${weapon}, ${profile}` : weapon);

/** An attack, melee profile or power whose modifiers can be copied. */
export interface ModSource {
    path: string;
    /** Melee or Ranged for weapons, the name of its tab for a power. */
    group: string;
    label: string;
    mods: WeaponMod[];
}

/** The items of `candidates` with modifiers of `stat`, but the one at `exceptPath`. */
function withMods(candidates: Omit<ModSource, "mods">[], exceptPath: string, stat: WeaponStat): ModSource[] {
    return candidates
        .filter(c => c.path !== exceptPath)
        .map(c => ({ ...c, mods: modsAt(c.path, stat) }))
        .filter(c => c.mods.length > 0);
}

/**
 * The items whose damage and penetration take modifiers alike: the
 * references their expressions can hold and the items modifiers are copied
 * from.
 */
export interface DamageOwner {
    refs(itemPath: string): DamageRefs;
    /** The items with modifiers of `stat` but the one at `exceptPath`. */
    sources(exceptPath: string, stat: WeaponStat): ModSource[];
}

/** Melee profiles and ranged attacks. */
export const WEAPON_DAMAGE: DamageOwner = {
    refs: () => ({ keys: refKeys(), named: WEAPON_REFS, valueOf: refValue }),
    sources(exceptPath, stat) {
        const melee = idsInOrder("meleeAttacks.list.items").flatMap(id => {
            const attack = `meleeAttacks.list.items.${id}`;
            const weapon = textAt(`${attack}.name`).trim() || "Melee Attack";
            return idsInOrder(`${attack}.tabs.items`).map(tab => {
                const path = `${attack}.tabs.items.${tab}`;
                return { path, group: "Melee", label: profileLabel(weapon, textAt(`${path}.profile`).trim()) };
            });
        });
        const ranged = idsInOrder("rangedAttacks.list.items").map(id => {
            const path = `rangedAttacks.list.items.${id}`;
            return { path, group: "Ranged", label: textAt(`${path}.name`).trim() || "Ranged Attack" };
        });
        return withMods([...melee, ...ranged], exceptPath, stat);
    },
};

/** Psychic powers: PR is the PR of the power's cast. */
export const POWER_DAMAGE: DamageOwner = {
    refs: path => ({ keys: refKeys(), named: POWER_REFS, valueOf: ref => (ref === POWER_PR ? powerPR(path) : refValue(ref)) }),
    sources: (exceptPath, stat) => withMods(psychicPowers().map(({ path, tabPath }) => ({
        path, group: textAt(`${tabPath}.name`).trim() || "Tab", label: textAt(`${path}.name`).trim() || "Psychic Power",
    })), exceptPath, stat),
};

/** Tech powers: their damage holds a weapon's references, I.b above all. */
export const TECH_DAMAGE: DamageOwner = {
    refs: WEAPON_DAMAGE.refs,
    sources: (exceptPath, stat) => withMods(idsInOrder("technoArcana.tabs.items").flatMap(tabId => {
        const tabPath = `technoArcana.tabs.items.${tabId}`;
        const group = textAt(`${tabPath}.name`).trim() || "Tab";
        return idsInOrder(`${tabPath}.powers.items`).map(id => {
            const path = `${tabPath}.powers.items.${id}`;
            return { path, group, label: textAt(`${path}.name`).trim() || "Tech Power" };
        });
    }), exceptPath, stat),
};
