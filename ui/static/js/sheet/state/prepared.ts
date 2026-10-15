// The prepared spells of Pathfinder Crusade (wiki «… › волшебник › Трейты ›
// Arcane Spellcasting», «… › священник › Трейты › Divine Spellcasting»): at
// the start of the day a caster of a Spellcasting variant that prepares
// (state/spellcasting.ts) prepares up to I.b + PR spells and casts them any
// number of times. The sheet knows no days: the
// player unprepares all and marks the spells of the day. Sorcery spells are
// not prepared.
import { untracked } from "@preact/signals-core";
import type { SheetOps } from "./actions";
import { characteristicBonus } from "./characteristics";
import { isSorcery, psychicPowers } from "./psychic";
import { preparesBySpellcasting } from "./spellcasting";
import { numberAt, valueAt } from "./sync";
import type { SheetSignals } from "../schema/sheet";

/** Whether the sheet counts prepared spells: its rule is on and a Spellcasting variant ticked prepares. */
export const preparing = (state: SheetSignals) => !!valueAt(state, "settings.psykana.prepared") && preparesBySpellcasting(state);

// A Sorcery spell is not prepared: a half-caster casts any of them at any time.
const preparedSpells = (state: SheetSignals) =>
    psychicPowers(state).filter(({ path }) => !!valueAt(state, `${path}.prepared`) && !isSorcery(state, path));

export const preparedCount = (state: SheetSignals) => preparedSpells(state).length;

/** How many spells a day: I.b + the base PR, without modifiers. */
export const preparedLimit = (state: SheetSignals) => characteristicBonus(state, "I") + numberAt(state, "psykana.basePR");

/** Unprepares every spell; a sustained one stays sustained. */
export function unprepareAll({ state, actions }: Pick<SheetOps, "state" | "actions">) {
    for (const { path } of untracked(() => preparedSpells(state))) actions.change(`${path}.prepared`, false);
}
