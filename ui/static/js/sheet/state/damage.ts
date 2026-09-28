// The damage of a weapon with its modifiers (damage.ts), as the character's
// state gives the references their values. Reactive when read inside a computed.
import { Signal } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import { BASE_PR, resolveDamage, type DamageMod, type ResolvedDamage } from "../damage";
import { calculateCharacteristicBase } from "../system";
import { characterState } from "./state";
import { resolvePath } from "./sync";

/** A characteristic's bonus as initiative counts it, or the base psy rating. */
export function damageRefValue(ref: string): number {
    if (ref === BASE_PR) return Number(characterState.psykana?.basePR?.value) || 0;
    const char = characterState.characteristics?.[ref];
    return char ? calculateCharacteristicBase(char.calculatedValue?.value ?? 0, char.calculatedUnnatural?.value ?? 0) : 0;
}

type ModSignals = { [K in keyof DamageMod]?: Signal<DamageMod[K]> };

/** The modifiers of the damage at `itemPath` in the order of their grid. */
function modsAt(itemPath: string): DamageMod[] {
    const items = resolvePath(`${itemPath}.damageMods.items`);
    const layouts = resolvePath(`${itemPath}.damageMods.layouts`);
    if (!items || items instanceof Signal || typeof items !== "object") return [];
    const positions = (layouts instanceof Signal ? layouts.value : {}) as { [id: string]: Position | undefined };
    const at = (id: string) => positions[id] ?? { colIndex: 0, rowIndex: 0 };
    return Object.keys(items)
        .sort((a, b) => at(a).colIndex - at(b).colIndex || at(a).rowIndex - at(b).rowIndex)
        .map(id => (items as { [id: string]: ModSignals })[id])
        .map(mod => ({ expr: mod.expr?.value ?? "", name: mod.name?.value ?? "", enabled: mod.enabled?.value ?? false }));
}

/** The damage of the attack or melee profile at `itemPath` with its modifiers. */
export function damageAt(itemPath: string): ResolvedDamage {
    const base = resolvePath(`${itemPath}.damage`);
    return resolveDamage(
        base instanceof Signal ? String(base.value ?? "") : "",
        modsAt(itemPath),
        Object.keys(characterState.characteristics ?? {}),
        damageRefValue,
    );
}
