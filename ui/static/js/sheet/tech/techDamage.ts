// The damage and penetration of tech powers, as rolls/damage.ts counts them.
import { WEAPON_REFS } from "../rolls/damageExpression";
import { characteristicBonus } from "../characteristics/characteristicRules";
import { hardwareAt } from "./hardware";
import { refValue } from "../rolls/resourceStat";
import { techPowers, technoRule } from "./tech";
import { textAt } from "../core/sync";
import { refKeys, withMods, type DamageOwner } from "../rolls/damage";
import type { FieldOwner } from "../rolls/ModdedField";

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

export const TECH_FIELD: FieldOwner = {
    damage: TECH_DAMAGE,
    noun: "power",
    label: "Power",
    stats: {
        damage: { own: "The power's own damage, as the rulebook gives it", placeholder: "1d10+I.b", hint: "Add I.b, 1d10 or a number." },
        pen: { own: "The power's own penetration, as the rulebook gives it", placeholder: "½I.b▲", hint: "Add ½I.b▲ or a number." },
    },
    exprPlaceholder: "I.b, ½I.b▲, 1d10",
    exprHelp: [],
    own: (_, __, base) => `Power ${base}`,
    // Its own damage mostly counts I.b.
    explainsOwn: true,
};
