// The cast of a psychic power: what it records on the power, its test, and
// what the test comes to for the sustaining and the phenomena.
import { untracked } from "@preact/signals-core";
import { nanoid } from "nanoid";
import type { SheetOps } from "../core/actions";
import { phenomenaReason, sustainAfterCast } from "./psychic";
import { peekAt } from "../core/sync";
import type { Label } from "../rollLabel";

export interface Cast {
    effectivePR: number;
    /** The kick; 0 in a safe cast. */
    kick: number;
    safe: boolean;
    /** The test: its target, bonus successes and label in the chat. */
    target: number;
    bonusSuccesses: number;
    label: Label;
    /** Sustain the power once its test succeeds, free by Cycle or not; null leaves its sustaining alone. */
    sustain: { free: boolean } | null;
    /** Pays the cast once its test succeeds: a failed one costs nothing; a kind's (SheetKindDef.castCost). */
    pay?: () => void;
    /** An Arts spell's cast (magic/artsRules.ts): it has no phenomena, nor is it the last cast they count. */
    arts?: boolean;
}

/**
 * Casts the power at `path`: records the cast, whose PR its damage counts,
 * and rolls its test. Resolves once the test is back and has paid for a
 * success, marked the power sustained or called for phenomena.
 */
export function castPower(sheet: SheetOps, path: string, cast: Cast): Promise<void> {
    const { state, actions } = sheet;
    const { kick, safe } = cast;
    const pr = cast.effectivePR + kick;
    // A pushed cast calls for phenomena before its test is back; a normal one by what the test came to.
    const called = cast.arts ? "" : phenomenaReason({ safe, kick }, null);
    const requestId = nanoid();
    actions.batch(path, { cast: { pr, kick, safe, phenomena: called, requestId } });
    if (!cast.arts) actions.change("psykana.lastCastPower", path.slice(path.lastIndexOf(".") + 1));
    return sheet.rolls.versus(cast.target, cast.bonusSuccesses, cast.label, requestId).then(outcome => {
        // A test that never comes back (the sheet closed, the connection lost) pays nothing either.
        if (outcome?.success) cast.pay?.();
        // From the sustaining as it is now: casts of a Repeatable power may have come back meanwhile.
        const sustained = cast.sustain && outcome?.success ? untracked(() => sustainAfterCast(state, path, pr, cast.sustain!.free)) : null;
        if (sustained) actions.batch(`${path}.sustain`, sustained);
        // The power may have been cast again while the test was on its way.
        if (cast.arts || peekAt(state, `${path}.cast.requestId`) !== requestId) return;
        const reason = phenomenaReason({ safe, kick }, outcome);
        if (reason !== called) actions.batch(`${path}.cast`, { phenomena: reason });
    });
}
