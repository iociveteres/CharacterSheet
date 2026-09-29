// The damage and penetration of a weapon or psychic power with their
// modifiers (damage.ts), as the character's state gives the references their
// values. Reactive when read inside a computed.
import { nanoid } from "nanoid";
import { BASE_PR, POWER_PR, POWER_REFS, WEAPON_REFS, resolveDamage, type WeaponMod, type ResolvedDamage } from "../damage";
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

/** Whether the item at `itemPath` is a psychic power rather than an attack or melee profile. */
export const isPowerPath = (itemPath: string) => itemPath.startsWith("psykana.");

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

/** The references of the attack, melee profile or psychic power at `itemPath`: a power adds its PR. */
export function refsAt(itemPath: string): DamageRefs {
    const keys = refKeys();
    if (!isPowerPath(itemPath)) return { keys, named: WEAPON_REFS, valueOf: refValue };
    return { keys, named: POWER_REFS, valueOf: ref => (ref === POWER_PR ? powerPR(itemPath) : refValue(ref)) };
}

/** A value of a weapon or power that takes modifiers: its own in `stat`, the modifiers in `${stat}Mods`. */
export type WeaponStat = "damage" | "pen";

/** The modifiers of `stat` of the attack or melee profile at `itemPath`, in the order of their grid. */
export function modsAt(itemPath: string, stat: WeaponStat): WeaponMod[] {
    const grid = `${itemPath}.${stat}Mods.items`;
    return idsInOrder(grid).map(id => ({ expr: textAt(`${grid}.${id}.expr`), enabled: !!valueAt(`${grid}.${id}.enabled`) }));
}

/** `stat` of the attack, melee profile or psychic power at `itemPath` with its modifiers. */
export function statAt(itemPath: string, stat: WeaponStat): ResolvedDamage {
    const { keys, named, valueOf } = refsAt(itemPath);
    return resolveDamage(textAt(`${itemPath}.${stat}`), modsAt(itemPath, stat), keys, valueOf, named);
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

/** An attack, melee profile or psychic power whose modifiers can be copied. */
export interface ModSource {
    path: string;
    /** Melee or Ranged for weapons, the name of its tab for a power. */
    group: string;
    label: string;
    mods: WeaponMod[];
}

/**
 * The items of the sheet with modifiers of `stat` like the one at
 * `exceptPath`, but that one: melee profiles and ranged attacks for a weapon,
 * psychic powers for a power.
 */
export function modSources(exceptPath: string, stat: WeaponStat): ModSource[] {
    const out: ModSource[] = [];
    const add = (group: string, path: string, label: string) => {
        const mods = path === exceptPath ? [] : modsAt(path, stat);
        if (mods.length) out.push({ path, group, label, mods });
    };
    if (isPowerPath(exceptPath)) {
        for (const { path, tabPath } of psychicPowers()) add(textAt(`${tabPath}.name`).trim() || "Tab", path, textAt(`${path}.name`).trim() || "Psychic Power");
        return out;
    }
    for (const id of idsInOrder("meleeAttacks.list.items")) {
        const attack = `meleeAttacks.list.items.${id}`;
        const weapon = textAt(`${attack}.name`).trim() || "Melee Attack";
        for (const tab of idsInOrder(`${attack}.tabs.items`)) {
            add("Melee", `${attack}.tabs.items.${tab}`, profileLabel(weapon, textAt(`${attack}.tabs.items.${tab}.profile`).trim()));
        }
    }
    for (const id of idsInOrder("rangedAttacks.list.items")) {
        const attack = `rangedAttacks.list.items.${id}`;
        add("Ranged", attack, textAt(`${attack}.name`).trim() || "Ranged Attack");
    }
    return out;
}
