// The fields of the Techno Arcana stats: the maximum and restoration of
// cognition and energy, with the defaults of the rules (rolls/ResourceField.tsx).
import { StatField, type StatTexts } from "../rolls/ResourceField";
import { RESOURCE_DEFAULTS, resourceStat, type ResourceKey } from "./tech";

const RESOURCE_HINT = "An implant or talent, as Explorator −1.";

const TEXTS: { [K in ResourceKey]: StatTexts } = {
    cognitionMax: { noun: "maximum of cognition", rule: "⚙ up to I.b", hint: RESOURCE_HINT },
    cognitionRestore: { noun: "cognition a turn restores", rule: "½I.b▲ ⚙ a turn", hint: RESOURCE_HINT },
    energyMax: { noun: "maximum of energy", rule: "a Potentia Coil holds 3 🗲 (Poor.Q 1, Good.Q 5, Best.Q 7)", hint: RESOURCE_HINT },
    energyRestore: { noun: "energy a turn restores", rule: "a turn restores no 🗲", hint: RESOURCE_HINT },
};

/** The field of the stat `stat` of Techno Arcana, at the enclosing path. */
export function TechResourceField({ stat }: { stat: ResourceKey }) {
    return <StatField field={stat} texts={TEXTS[stat]} fallback={RESOURCE_DEFAULTS[stat]} value={state => resourceStat(state, stat)} />;
}
