// The cast of a psychic power: what it records on the power, its test, and
// what the test comes to for the sustaining and the phenomena.
import { untracked } from "@preact/signals-core";
import { nanoid } from "nanoid";
import { rollVersus } from "../rollEvents";
import type { SheetActions } from "./actions";
import { phenomenaReason, sustainAfterCast } from "./psychic";
import { peekAt } from "./sync";

export interface Cast {
    effectivePR: number;
    /** The kick; 0 in a safe cast. */
    kick: number;
    safe: boolean;
    /** The test: its target, bonus successes and label in the chat. */
    target: number;
    bonusSuccesses: number;
    label: string;
    /** Sustain the power once its test succeeds, free by Cycle or not; null leaves its sustaining alone. */
    sustain: { free: boolean } | null;
}

/**
 * Casts the power at `path`: records the cast, whose PR its damage counts,
 * and rolls its test. Resolves once the test is back and has marked the
 * power sustained or called for phenomena.
 */
export function castPower(actions: SheetActions, path: string, cast: Cast): Promise<void> {
    const { kick, safe } = cast;
    const pr = cast.effectivePR + kick;
    // Worked out now, from the sustaining the power has before the cast.
    const sustained = cast.sustain ? untracked(() => sustainAfterCast(path, pr, cast.sustain!.free)) : null;
    // A pushed cast calls for phenomena before its test is back; a normal one by what the test came to.
    const called = phenomenaReason({ safe, kick }, null);
    const requestId = nanoid();
    actions.batch(path, { cast: { pr, kick, safe, phenomena: called, requestId } });
    actions.change("psykana.lastCastPower", path.slice(path.lastIndexOf(".") + 1));
    return rollVersus(cast.target, cast.bonusSuccesses, cast.label, requestId).then(outcome => {
        if (sustained && outcome?.success) actions.batch(`${path}.sustain`, sustained);
        // The power may have been cast again while the test was on its way.
        if (peekAt(`${path}.cast.requestId`) !== requestId) return;
        const reason = phenomenaReason({ safe, kick }, outcome);
        if (reason !== called) actions.batch(`${path}.cast`, { phenomena: reason });
    });
}
