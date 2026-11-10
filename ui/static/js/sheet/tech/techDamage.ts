// The damage and penetration of tech powers, as damage.ts counts them.
import { WEAPON_REFS } from "../damage";
import { characteristicBonus } from "../characteristics/characteristicRules";
import { hardwareAt } from "./hardware";
import { refValue } from "../rolls/resourceStat";
import { techPowers, technoRule } from "./tech";
import { textAt } from "../core/sync";
import { refKeys, withMods, type DamageOwner } from "../rolls/damage";

/**
 * Tech powers: their damage holds a weapon's references, I.b above all, whose
 * I the quality of the power's hardware changes.
 */
export const TECH_DAMAGE: DamageOwner = {
    refs: (state, path) => {
        // Read once for the whole expression, at its first I.
        let hardware: number | undefined;
        return {
            keys: refKeys(state),
            named: WEAPON_REFS,
            valueOf: ref => (ref === "I" && technoRule(state, "hardware") ? characteristicBonus(state, "I", hardware ??= hardwareAt(state, path).mod) : refValue(state, ref)),
        };
    },
    sources: (state, exceptPath, stat) => withMods(state, techPowers(state).map(({ path, tabId }) => ({
        path,
        group: textAt(state, `technoArcana.tabs.items.${tabId}.name`).trim() || "Tab",
        label: textAt(state, `${path}.name`).trim() || "Tech Power",
    })), exceptPath, stat),
};
