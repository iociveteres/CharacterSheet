// The damage and penetration of psychic powers, as damage.ts counts them:
// PR in an expression is the PR of the power's cast.
import { POWER_PR, POWER_REFS } from "../damage";
import { castCap, isArts, psychicPowers } from "./psychic";
import { artsCap } from "./arts";
import { refValue } from "../rolls/resourceStat";
import { numberAt, textAt } from "../core/sync";
import { refKeys, withMods, type DamageOwner } from "../rolls/damage";
import type { SheetSignals } from "../schema/sheet";

/** The PR the damage of the power at `powerPath` counts before a cast: a normal cast's, or the Max of an Arts spell. */
export const uncastPR = (state: SheetSignals, powerPath: string): number =>
    (isArts(state, powerPath) ? artsCap(state, powerPath).max : castCap(state, powerPath));

/** The PR the damage of the power at `powerPath` counts: its last cast's, or uncastPR before one. */
export function powerPR(state: SheetSignals, powerPath: string): number {
    const pr = numberAt(state, `${powerPath}.cast.pr`);
    return pr > 0 ? pr : uncastPR(state, powerPath);
}

export const POWER_DAMAGE: DamageOwner = {
    refs: (state, path) => ({ keys: refKeys(state), named: POWER_REFS, valueOf: ref => (ref === POWER_PR ? powerPR(state, path) : refValue(state, ref)) }),
    sources: (state, exceptPath, stat) => withMods(state, psychicPowers(state).map(({ path, tabPath }) => ({
        path, group: textAt(state, `${tabPath}.name`).trim() || "Tab", label: textAt(state, `${path}.name`).trim() || "Psychic Power",
    })), exceptPath, stat),
};
