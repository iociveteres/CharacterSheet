// The activation of a tech power: its price, the Processes and the
// compensation of a Compensator power.
import { untracked } from "@preact/signals-core";
import type { SheetOps } from "../core/actions";
import { numberAt, peekAt } from "../core/sync";
import { FATIGUE, spend } from "../powers/spend";
import { COGNITION, ENERGY, processAfterActivation, resourceStat, techTraitsAt, technoRule } from "./tech";

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

/**
 * Pays `energy` 🗲: `asFatigue` of it with Fatigue, the rest from the energy
 * and what the energy lacks with Fatigue too, 1 for each 🗲. Returns how it
 * was paid.
 */
function payEnergy(sheet: Pick<SheetOps, "state" | "actions">, energy: number, asFatigue: number): { energy: number; fatigue: number } {
    const { state, actions } = sheet;
    const due = Math.ceil(energy);
    const byChoice = Math.min(Math.max(0, asFatigue), due);
    const fromEnergy = Math.min(due - byChoice, untracked(() => numberAt(state, ENERGY)));
    spend(sheet, ENERGY, fromEnergy);
    const fatigue = due - fromEnergy;
    if (fatigue > 0) actions.change(FATIGUE, untracked(() => numberAt(state, FATIGUE)) + fatigue);
    return { energy: fromEnergy, fatigue };
}

export const COMPENSATION = "technoArcana.compensation";

/**
 * Gives back what the compensation roll's `successes` take off the energy the
 * last Compensator activation, of the power with the item id `power`, paid:
 * the Fatigue first, then the 🗲 up to its maximum. The activation is settled either way.
 */
export function compensate(sheet: Pick<SheetOps, "state" | "actions">, successes: number, power: string) {
    const { state, actions } = sheet;
    const [current, fatigue, energy] = untracked(() =>
        [String(peekAt(state, `${COMPENSATION}.power`) ?? ""), numberAt(state, `${COMPENSATION}.fatigue`), numberAt(state, `${COMPENSATION}.energy`)] as const);
    // The roll came back after another activation had replaced its power.
    if (!power || current !== power) return;
    const offFatigue = Math.min(fatigue, Math.max(0, successes));
    const offEnergy = Math.min(energy, Math.max(0, successes) - offFatigue);
    if (offFatigue > 0) actions.change(FATIGUE, Math.max(0, untracked(() => numberAt(state, FATIGUE)) - offFatigue));
    if (offEnergy > 0) {
        // Up to the maximum, as a typed value; an energy already past it stays.
        const [now, max] = untracked(() => [numberAt(state, ENERGY), resourceStat(state, "energyMax").total]);
        actions.change(ENERGY, Math.max(now, Math.min(max, now + offEnergy)));
    }
    actions.batch(COMPENSATION, { power: "", x: 0, energy: 0, fatigue: 0 });
}

/**
 * Activates the tech power at `path`: its ⚙ is spent before the test, its 🗲
 * only once the test succeeds, and then it is held in a Process; each while
 * the sheet counts it (settings.technoArcana). Resolves once the test is back.
 */
export function activateTechPower(sheet: SheetOps, path: string, activation: Activation): Promise<void> {
    const { state, actions } = sheet;
    const { price, compensator, litany } = untracked(() => techTraitsAt(state, path, activation.x));
    const [paid, held] = untracked(() => [technoRule(state, "price"), technoRule(state, "processes")]);
    // Only the last activation can be compensated: the one before keeps its price as paid.
    if (untracked(() => peekAt(state, `${COMPENSATION}.power`))) actions.batch(COMPENSATION, { power: "", x: 0, energy: 0, fatigue: 0 });
    if (paid) spend(sheet, COGNITION, price.cognition);
    const { test } = activation;
    const outcome = test ? sheet.rolls.versus(test.target, test.bonusSuccesses, test.label) : Promise.resolve({ success: true });
    return outcome.then(result => {
        if (!result?.success) return;
        // A Litany is used up by its activation, not by a failed one.
        if (litany !== undefined && held) actions.change(`${path}.compiled`, Math.max(0, untracked(() => numberAt(state, `${path}.compiled`)) - 1));
        if (paid && price.energy > 0) {
            const spent = payEnergy(sheet, price.energy, activation.energyAsFatigue);
            // Offered, not rolled: the player may compensate with the Compensation Roll, set to X.
            if (compensator !== undefined) {
                actions.batch(COMPENSATION, { power: path.slice(path.lastIndexOf(".") + 1), x: compensator, ...spent });
                actions.change("technoArcana.compensationRoll.modifier", compensator);
            }
        }
        if (!activation.process || !held) return;
        for (const [powerPath, change] of untracked(() => processAfterActivation(state, path, activation.x))) {
            actions.batch(`${powerPath}.inProcess`, change);
        }
    });
}
