// The damage and penetration of melee profiles and ranged attacks, as
// damage.ts counts them: what grips, weapon entries, the linked gear item,
// a linked trait and talents add.
import { WEAPON_REFS, type WeaponMod } from "../damage";
import { idsInOrder } from "../core/gridOrder";
import { refValue } from "../rolls/resourceStat";
import { attackOfTab, gripProperties, gripStat, heldGrip } from "./melee";
import { MACE_PROFILE } from "./grips";
import { statBonusMods } from "./weaponBonus";
import { addedProperties, materialPenMods } from "./itemLink";
import { qualitySpecial, withoutProperties } from "./quality";
import { traitMods } from "./traitLink";
import { talentDamageMods } from "./talentBonus";
import { textAt } from "../core/sync";
import { refKeys, withMods, type DamageOwner } from "../rolls/damage";
import type { SheetSignals } from "../schema/sheet";

/**
 * The Special of the item at `itemPath` as it counts: its own (the Mace's in
 * Mordhau), what its grip adds, the enchantments of its linked item and what
 * its Quality adds, without what the Quality removes.
 */
function specialAt(state: SheetSignals, itemPath: string): string {
    const melee = itemPath.startsWith("meleeAttacks.");
    const own = melee && heldGrip(state, attackOfTab(itemPath)).effects.mace ? MACE_PROFILE.special : textAt(state, `${itemPath}.special`);
    const quality = qualitySpecial(state, itemPath);
    return [withoutProperties(own, quality?.removed ?? []), ...(melee ? gripProperties(state, itemPath) : []), ...addedProperties(state, itemPath).map(p => p.text), ...(quality?.added ?? [])].join(", ");
}

/**
 * The Strength bonus that melee adds to damage: a new melee profile has it,
 * as internal/gamedata/melee.go gives the profiles picked from the collection.
 */
export const STRENGTH_BONUS: WeaponMod = { expr: "S.b", enabled: true };

/** The label of a melee profile's rolls: the weapon, and the profile unless it is none. */
export const profileLabel = (weapon: string, profile: string) => (profile && profile !== "no" ? `${weapon}, ${profile}` : weapon);

/** Melee profiles and ranged attacks; weapon entries, the material of a linked gear item, X of a linked trait and talents (talentBonus.ts) add to them. */
export const WEAPON_DAMAGE: DamageOwner = {
    refs: state => ({ keys: refKeys(state), named: WEAPON_REFS, valueOf: ref => refValue(state, ref) }),
    counts(state, itemPath, stat, own, mods, keys) {
        const counts = itemPath.startsWith("meleeAttacks.") ? gripStat(state, itemPath, stat, own, mods, keys) : { base: own, mods, own: null };
        const material = stat === "pen" ? materialPenMods(state, itemPath) : [];
        const talents = talentDamageMods(state, itemPath, stat, counts.base, counts.mods);
        return { ...counts, mods: [...counts.mods, ...statBonusMods(state, itemPath, stat), ...material, ...traitMods(state, itemPath, stat), ...talents] };
    },
    special: specialAt,
    sources(state, exceptPath, stat) {
        const melee = idsInOrder(state, "meleeAttacks.list.items").flatMap(id => {
            const attack = `meleeAttacks.list.items.${id}`;
            const weapon = textAt(state, `${attack}.name`).trim() || "Melee Attack";
            return idsInOrder(state, `${attack}.tabs.items`).map(tab => {
                const path = `${attack}.tabs.items.${tab}`;
                return { path, group: "Melee", label: profileLabel(weapon, textAt(state, `${path}.profile`).trim()) };
            });
        });
        const ranged = idsInOrder(state, "rangedAttacks.list.items").map(id => {
            const path = `rangedAttacks.list.items.${id}`;
            return { path, group: "Ranged", label: textAt(state, `${path}.name`).trim() || "Ranged Attack" };
        });
        return withMods(state, [...melee, ...ranged], exceptPath, stat);
    },
};
