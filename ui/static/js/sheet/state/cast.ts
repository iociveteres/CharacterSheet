// The cast of a psychic power: what it records on the power, its test, and
// what the test comes to for the sustaining and the phenomena. The
// activation of a tech power: its price and the Processes.
import { untracked } from "@preact/signals-core";
import { nanoid } from "nanoid";
import { rollVersus } from "../rollEvents";
import type { SheetActions } from "./actions";
import { phenomenaReason, sustainAfterCast } from "./psychic";
import { numberAt, peekAt } from "./sync";
import { COGNITION, ENERGY, processAfterActivation, techTraitsAt, technoRule } from "./tech";

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
    // A pushed cast calls for phenomena before its test is back; a normal one by what the test came to.
    const called = phenomenaReason({ safe, kick }, null);
    const requestId = nanoid();
    actions.batch(path, { cast: { pr, kick, safe, phenomena: called, requestId } });
    actions.change("psykana.lastCastPower", path.slice(path.lastIndexOf(".") + 1));
    return rollVersus(cast.target, cast.bonusSuccesses, cast.label, requestId).then(outcome => {
        // From the sustaining as it is now: casts of a Repeatable power may have come back meanwhile.
        const sustained = cast.sustain && outcome?.success ? untracked(() => sustainAfterCast(path, pr, cast.sustain!.free)) : null;
        if (sustained) actions.batch(`${path}.sustain`, sustained);
        // The power may have been cast again while the test was on its way.
        if (peekAt(`${path}.cast.requestId`) !== requestId) return;
        const reason = phenomenaReason({ safe, kick }, outcome);
        if (reason !== called) actions.batch(`${path}.cast`, { phenomena: reason });
    });
}

export interface Activation {
    /** X of a price of X ⚙. */
    x: number;
    /** The test: its target, bonus successes and label in the chat; null for a power activated without one. */
    test: { target: number; bonusSuccesses: number; label: string } | null;
    /** Hold the power in a Process once it is activated. */
    process: boolean;
    /** How much of the 🗲 to pay with Fatigue rather than energy. */
    energyAsFatigue: number;
}

export const FATIGUE = "fatigue.fatigueCur";

/** Takes `amount` from the resource at `path`, down to 0. */
function spend(actions: SheetActions, path: string, amount: number) {
    if (amount > 0) actions.change(path, Math.max(0, untracked(() => numberAt(path)) - Math.ceil(amount)));
}

/**
 * Pays `energy` 🗲: `asFatigue` of it with Fatigue, the rest from the energy
 * and what the energy lacks with Fatigue too, 1 for each 🗲. Returns how it
 * was paid.
 */
function payEnergy(actions: SheetActions, energy: number, asFatigue: number): { energy: number; fatigue: number } {
    const due = Math.ceil(energy);
    const byChoice = Math.min(Math.max(0, asFatigue), due);
    const fromEnergy = Math.min(due - byChoice, untracked(() => numberAt(ENERGY)));
    spend(actions, ENERGY, fromEnergy);
    const fatigue = due - fromEnergy;
    if (fatigue > 0) actions.change(FATIGUE, untracked(() => numberAt(FATIGUE)) + fatigue);
    return { energy: fromEnergy, fatigue };
}

export const COMPENSATION = "technoArcana.compensation";

/**
 * Gives back what the compensation roll's `successes` take off the energy the
 * last Compensator activation, of the power with the item id `power`, paid:
 * the Fatigue first, then the 🗲. The activation is settled either way.
 */
export function compensate(actions: SheetActions, successes: number, power: string) {
    const [current, fatigue, energy] = untracked(() =>
        [String(peekAt(`${COMPENSATION}.power`) ?? ""), numberAt(`${COMPENSATION}.fatigue`), numberAt(`${COMPENSATION}.energy`)] as const);
    // The roll came back after another activation had replaced its power.
    if (!power || current !== power) return;
    const offFatigue = Math.min(fatigue, Math.max(0, successes));
    const offEnergy = Math.min(energy, Math.max(0, successes) - offFatigue);
    if (offFatigue > 0) actions.change(FATIGUE, Math.max(0, untracked(() => numberAt(FATIGUE)) - offFatigue));
    if (offEnergy > 0) actions.change(ENERGY, untracked(() => numberAt(ENERGY)) + offEnergy);
    actions.batch(COMPENSATION, { power: "", x: 0, energy: 0, fatigue: 0 });
}

/**
 * Activates the tech power at `path`: its ⚙ is spent before the test, its 🗲
 * only once the test succeeds, and then it is held in a Process; each while
 * the sheet counts it (settings.technoArcana). Resolves once the test is back.
 */
export function activateTechPower(actions: SheetActions, path: string, activation: Activation): Promise<void> {
    const { price, compensator, litany } = untracked(() => techTraitsAt(path, activation.x));
    const [paid, held] = untracked(() => [technoRule("price"), technoRule("processes")]);
    // Only the last activation can be compensated: the one before keeps its price as paid.
    if (untracked(() => peekAt(`${COMPENSATION}.power`))) actions.batch(COMPENSATION, { power: "", x: 0, energy: 0, fatigue: 0 });
    if (paid) spend(actions, COGNITION, price.cognition);
    const { test } = activation;
    const outcome = test ? rollVersus(test.target, test.bonusSuccesses, test.label) : Promise.resolve({ success: true });
    return outcome.then(result => {
        if (!result?.success) return;
        // A Litany is used up by its activation, not by a failed one.
        if (litany !== undefined && held) actions.change(`${path}.compiled`, Math.max(0, untracked(() => numberAt(`${path}.compiled`)) - 1));
        if (paid && price.energy > 0) {
            const spent = payEnergy(actions, price.energy, activation.energyAsFatigue);
            // Offered, not rolled: the player may compensate with the Compensation Roll, set to X.
            if (compensator !== undefined) {
                actions.batch(COMPENSATION, { power: path.slice(path.lastIndexOf(".") + 1), x: compensator, ...spent });
                actions.change("technoArcana.compensationRoll.modifier", compensator);
            }
        }
        if (!activation.process || !held) return;
        for (const [powerPath, change] of untracked(() => processAfterActivation(path, activation.x))) {
            actions.batch(`${powerPath}.inProcess`, change);
        }
    });
}
