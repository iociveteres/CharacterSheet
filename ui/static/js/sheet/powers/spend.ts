// What casting and activating powers spend: mana (magic/manaRules.ts), ⚙ and
// 🗲 (tech), and the Fatigue that pays for what the energy lacks.
import { untracked } from "@preact/signals-core";
import type { SheetOps } from "../core/actions";
import { numberAt } from "../core/sync";

export const FATIGUE = "fatigue.fatigueCur";

/** Takes `amount` from the resource at `path`, down to 0. */
export function spend({ state, actions }: Pick<SheetOps, "state" | "actions">, path: string, amount: number) {
    if (amount > 0) actions.change(path, Math.max(0, untracked(() => numberAt(state, path)) - Math.ceil(amount)));
}
