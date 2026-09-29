// The damage and penetration of a weapon or psychic power with their
// modifiers (damage.ts), as the character's state gives the references their
// values. Reactive when read inside a computed.
import { Signal } from "@preact/signals-core";
import { nanoid } from "nanoid";
import type { Position } from "../schema/content.gen";
import { BASE_PR, POWER_PR, POWER_REFS, WEAPON_REFS, resolveDamage, type WeaponMod, type ResolvedDamage } from "../damage";
import { characteristicBonus } from "./characteristics";
import { columnsFromLayout } from "../components/columns";
import { characterState } from "./state";
import { idsInOrder } from "./gridOrder";
import { castCap, psychicPowers } from "./psychic";
import { resolvePath } from "./sync";

/** A characteristic's bonus, or the base psy rating. */
export function refValue(ref: string): number {
    return ref === BASE_PR ? Number(characterState.psykana?.basePR?.value) || 0 : characteristicBonus(ref);
}

/** The characteristics a reference can name: those of the open sheet. */
export const refKeys = (): string[] => Object.keys(characterState.characteristics ?? {});

/** Whether the item at `itemPath` is a psychic power rather than an attack or melee profile. */
export const isPowerPath = (itemPath: string) => itemPath.startsWith("psykana.");

/** The PR the damage of the power at `powerPath` counts: its last cast's, the PR of a normal cast before one. */
export function powerPR(powerPath: string): number {
    const cast = resolvePath(`${powerPath}.cast.pr`);
    const pr = cast instanceof Signal ? Number(cast.value) || 0 : 0;
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

type ModSignals = { [K in keyof WeaponMod]?: Signal<WeaponMod[K]> };

/** The modifiers of `stat` of the attack or melee profile at `itemPath`, in the order of their grid. */
export function modsAt(itemPath: string, stat: WeaponStat): WeaponMod[] {
    const items = resolvePath(`${itemPath}.${stat}Mods.items`);
    const layouts = resolvePath(`${itemPath}.${stat}Mods.layouts`);
    if (!items || items instanceof Signal || typeof items !== "object") return [];
    const positions = (layouts instanceof Signal ? layouts.value : {}) as { [id: string]: Position };
    return columnsFromLayout(1, positions, Object.keys(items))[0]
        .map(id => (items as { [id: string]: ModSignals })[id])
        .map(mod => ({ expr: mod.expr?.value ?? "", enabled: mod.enabled?.value ?? false }));
}

/** `stat` of the attack, melee profile or psychic power at `itemPath` with its modifiers. */
export function statAt(itemPath: string, stat: WeaponStat): ResolvedDamage {
    const base = resolvePath(`${itemPath}.${stat}`);
    const { keys, named, valueOf } = refsAt(itemPath);
    return resolveDamage(base instanceof Signal ? String(base.value ?? "") : "", modsAt(itemPath, stat), keys, valueOf, named);
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

const text = (path: string) => {
    const node = resolvePath(path);
    return node instanceof Signal ? String(node.value ?? "").trim() : "";
};

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
        for (const { path, tabPath } of psychicPowers()) add(text(`${tabPath}.name`) || "Tab", path, text(`${path}.name`) || "Psychic Power");
        return out;
    }
    for (const id of idsInOrder("meleeAttacks.list.items")) {
        const attack = `meleeAttacks.list.items.${id}`;
        const weapon = text(`${attack}.name`) || "Melee Attack";
        for (const tab of idsInOrder(`${attack}.tabs.items`)) {
            add("Melee", `${attack}.tabs.items.${tab}`, profileLabel(weapon, text(`${attack}.tabs.items.${tab}.profile`)));
        }
    }
    for (const id of idsInOrder("rangedAttacks.list.items")) {
        const attack = `rangedAttacks.list.items.${id}`;
        add("Ranged", attack, text(`${attack}.name`) || "Ranged Attack");
    }
    return out;
}
