// The damage of a weapon with its modifiers (damage.ts), as the character's
// state gives the references their values. Reactive when read inside a computed.
import { Signal } from "@preact/signals-core";
import { nanoid } from "nanoid";
import type { Position } from "../schema/content.gen";
import { BASE_PR, resolveDamage, type DamageMod, type ResolvedDamage } from "../damage";
import { calculateCharacteristicBase } from "../system";
import { columnsFromLayout } from "../components/columns";
import { characterState } from "./state";
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
        .map(mod => ({ expr: mod.expr?.value ?? "", name: mod.name?.value ?? "", enabled: mod.enabled?.value ?? false }));
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
export const STRENGTH_BONUS: DamageMod = { expr: "S.b", name: "", enabled: true };

/** A grid of `mods` under new ids, as a new item holds them. */
export function damageModsGrid(mods: readonly DamageMod[]) {
    const ids = mods.map(() => `damage-mod-${nanoid()}`);
    return {
        items: Object.fromEntries(mods.map(({ expr, name, enabled }, i) => [ids[i], name ? { expr, name, enabled } : { expr, enabled }])),
        layouts: Object.fromEntries(ids.map((id, i) => [id, { colIndex: 0, rowIndex: i }])),
    };
}
