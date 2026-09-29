// The damage of a weapon with its modifiers (damage.ts), as the character's
// state gives the references their values. Reactive when read inside a computed.
import { Signal } from "@preact/signals-core";
import { nanoid } from "nanoid";
import type { Position } from "../schema/content.gen";
import { BASE_PR, resolveDamage, type DamageMod, type ResolvedDamage } from "../damage";
import { calculateCharacteristicBase } from "../system";
import { columnsFromLayout } from "../components/columns";
import { characterState } from "./state";
import { gridSpecOf } from "./fromJson";
import { resolvePath } from "./sync";

/** A characteristic's bonus as initiative counts it, or the base psy rating. */
export function damageRefValue(ref: string): number {
    if (ref === BASE_PR) return Number(characterState.psykana?.basePR?.value) || 0;
    const char = characterState.characteristics?.[ref];
    return char ? calculateCharacteristicBase(char.calculatedValue?.value ?? 0, char.calculatedUnnatural?.value ?? 0) : 0;
}

/** The characteristics a reference can name: those of the open sheet. */
export const damageKeys = (): string[] => Object.keys(characterState.characteristics ?? {});

type ModSignals = { [K in keyof DamageMod]?: Signal<DamageMod[K]> };

/** The modifiers of the damage at `itemPath` in the order of their grid. */
export function damageModsAt(itemPath: string): DamageMod[] {
    const items = resolvePath(`${itemPath}.damageMods.items`);
    const layouts = resolvePath(`${itemPath}.damageMods.layouts`);
    if (!items || items instanceof Signal || typeof items !== "object") return [];
    const positions = (layouts instanceof Signal ? layouts.value : {}) as { [id: string]: Position };
    return columnsFromLayout(1, positions, Object.keys(items))[0]
        .map(id => (items as { [id: string]: ModSignals })[id])
        .map(mod => ({ expr: mod.expr?.value ?? "", enabled: mod.enabled?.value ?? false }));
}

/** The damage of the attack or melee profile at `itemPath` with its modifiers. */
export function damageAt(itemPath: string): ResolvedDamage {
    const base = resolvePath(`${itemPath}.damage`);
    return resolveDamage(
        base instanceof Signal ? String(base.value ?? "") : "",
        damageModsAt(itemPath),
        damageKeys(),
        damageRefValue,
    );
}

/**
 * The Strength bonus that melee adds to damage: a new melee profile has it,
 * as internal/gamedata/melee.go gives the profiles picked from the collection.
 */
export const STRENGTH_BONUS: DamageMod = { expr: "S.b", enabled: true };

/** A grid of `mods` under new ids, as a new item holds them. */
export function damageModsGrid(mods: readonly DamageMod[]) {
    const ids = mods.map(() => `damage-mod-${nanoid()}`);
    return {
        items: Object.fromEntries(mods.map(({ expr, enabled }, i) => [ids[i], { expr, enabled }])),
        layouts: Object.fromEntries(ids.map((id, i) => [id, { colIndex: 0, rowIndex: i }])),
    };
}

/** The label of a melee profile's rolls: the weapon, and the profile unless it is none. */
export const profileLabel = (weapon: string, profile: string) => (profile && profile !== "no" ? `${weapon}, ${profile}` : weapon);

/** An attack or melee profile whose modifiers can be copied. */
export interface DamageSource {
    path: string;
    group: "Melee" | "Ranged";
    label: string;
    mods: DamageMod[];
}

const text = (path: string) => {
    const node = resolvePath(path);
    return node instanceof Signal ? String(node.value ?? "").trim() : "";
};

/** The item ids of the grid at `gridPath` in the order it shows them. */
function idsInOrder(gridPath: string): string[] {
    const items = resolvePath(gridPath);
    if (!items || items instanceof Signal || typeof items !== "object") return [];
    const layouts = resolvePath(gridPath.replace(/items$/, "layouts"));
    const positions = (layouts instanceof Signal ? layouts.value : {}) as { [id: string]: Position };
    return columnsFromLayout(gridSpecOf(gridPath)?.columns ?? 1, positions, Object.keys(items)).flat();
}

/** The melee profiles and ranged attacks of the sheet that have modifiers, but the one at `exceptPath`. */
export function damageSources(exceptPath: string): DamageSource[] {
    const out: DamageSource[] = [];
    const add = (group: DamageSource["group"], path: string, label: string) => {
        const mods = path === exceptPath ? [] : damageModsAt(path);
        if (mods.length) out.push({ path, group, label, mods });
    };
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
