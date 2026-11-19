// The damage and penetration of tech powers, as rolls/damage.ts counts them.
import { WEAPON_REFS } from "../rolls/damageExpression";
import { characteristicBonus } from "../characteristics/characteristicRules";
import { hardwareAt } from "./hardware";
import { refValue } from "../rolls/resourceStat";
import { techPowers, technoRule } from "./tech";
import { textAt } from "../core/sync";
import { refKeys, withMods, type DamageOwner } from "../rolls/damage";
import type { FieldOwner } from "../rolls/ModdedField";
import { t } from "../../i18n";

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
        group: textAt(state, `technoArcana.tabs.items.${tabId}.name`).trim() || t("sheet.powers.tab"),
        label: textAt(state, `${path}.name`).trim() || t("sheet.termsPowers.tech.techPower"),
    })), exceptPath, stat),
};

export const TECH_FIELD: FieldOwner = {
    damage: TECH_DAMAGE,
    texts: {
        copyTitle: t("sheet.powers.field.copyTitle"),
        noSources: t("sheet.powers.field.noSources"),
        noExpression: { damage: t("sheet.powers.field.noExpression.damage"), pen: t("sheet.powers.field.noExpression.pen") },
    },
    label: t("sheet.termsPowers.tech.techPower.short"),
    stats: {
        damage: { own: t("sheet.tech.damage.own"), placeholder: "1d10+I.b", hint: t("sheet.tech.damage.hint") },
        pen: { own: t("sheet.tech.pen.own"), placeholder: "½I.b▲", hint: t("sheet.tech.pen.hint") },
    },
    exprPlaceholder: "I.b, ½I.b▲, 1d10",
    exprHelp: [],
    own: (_, __, base) => `${t("sheet.termsPowers.tech.techPower.short")} ${base}`,
    // Its own damage mostly counts I.b.
    explainsOwn: true,
};
