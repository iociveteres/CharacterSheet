// The initiative roll of a sheet. The raw roll is kept in lastInitiative, so
// the total the sheet shows follows the modifier as it changes. The sheet's
// own rolls bring the result back, so a sheet that is not rendered (an NPC of
// an encounter) keeps its roll too. The encounter reads and writes the
// initiative of its participants' sheets with the same functions.
import type { SheetSignals } from "../schema/sheet";
import type { SheetOps } from "./actions";
import { numberAt, peekAt } from "./sync";

/** The initiative roll of the sheet, "1d10+7"; "" when it has none. */
export function initiativeExpression(state: SheetSignals): string {
    return String(peekAt(state, "initiative.initiative") ?? "").trim();
}

/** The roll to keep in lastInitiative for an initiative of `total`: less the modifier the sheet has now. */
export function initiativeRollFor(state: SheetSignals, total: number): number {
    return total - (Number(peekAt(state, "initiative.modifier")) || 0);
}

/**
 * The initiative of the sheet: its roll plus its modifier now; null when it
 * has not rolled, since a kept roll of 0 means none. Subscribes as numberAt.
 */
export function initiativeTotal(state: SheetSignals): number | null {
    const roll = numberAt(state, "initiative.lastInitiative");
    return roll ? roll + numberAt(state, "initiative.modifier") : null;
}

/** Rolls the initiative of the sheet and keeps the roll less the modifier it has when the roll is back. */
export async function rollInitiative({ state, actions, rolls }: SheetOps): Promise<void> {
    const expression = initiativeExpression(state);
    if (!expression) return;
    const total = await rolls.exact(expression, "Initiative");
    if (total === null) return;
    actions.change("initiative.lastInitiative", initiativeRollFor(state, total));
}
