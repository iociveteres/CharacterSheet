// The fields of the Techno Arcana stats: the maximum and restoration of
// cognition and energy, with the defaults of the rules (rolls/ResourceField.tsx).
import { StatField, type StatTexts } from "../rolls/ResourceField";
import { RESOURCE_DEFAULTS, resourceStat, type ResourceKey } from "./tech";
import { t } from "../../i18n";

const RESOURCE_HINT = t("sheet.tech.resource.hint");

const TEXTS: { [K in ResourceKey]: StatTexts } = {
    cognitionMax: { noun: t("sheet.tech.resource.cognitionMaxNoun"), rule: t("sheet.tech.resource.cognitionMaxRule"), hint: RESOURCE_HINT },
    cognitionRestore: { noun: t("sheet.tech.resource.cognitionRestoreNoun"), rule: t("sheet.tech.resource.cognitionRestoreRule"), hint: RESOURCE_HINT },
    energyMax: { noun: t("sheet.tech.resource.energyMaxNoun"), rule: t("sheet.tech.resource.energyMaxRule"), hint: RESOURCE_HINT },
    energyRestore: { noun: t("sheet.tech.resource.energyRestoreNoun"), rule: t("sheet.tech.resource.energyRestoreRule"), hint: RESOURCE_HINT },
};

/** The field of the stat `stat` of Techno Arcana, at the enclosing path. */
export function TechResourceField({ stat }: { stat: ResourceKey }) {
    return <StatField field={stat} texts={TEXTS[stat]} fallback={RESOURCE_DEFAULTS[stat]} value={state => resourceStat(state, stat)} />;
}
