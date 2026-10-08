// The mana of Pathfinder Crusade (state/mana.ts): its row under the PR of the
// Magic tab and of the stat block, and what a cast costs in its roll. Only the layout of Pathfinder Crusade includes them.
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { Scope } from "../components/Scope";
import { numberAt } from "../state/sync";
import { MANA, MANA_REFS, canRestoreMana, manaMax, manaRule, restoreMana } from "../state/mana";
import type { SheetSignals } from "../schema/sheet";
import type { Rule } from "./BlockSettings";
import { RollRow } from "./Processes";
import { CurrentResource, StatField, type StatTexts } from "./ResourceField";

export const MANA_RULE: Rule = {
    field: "mana",
    label: "Mana",
    title: "A cast spends its effective PR of mana, kick included, before its test; without the mana it is not rolled.",
};

const MAX_TEXTS: StatTexts = {
    noun: "maximum of mana",
    rule: "the trait Caster of the class gives it",
    hint: "A talent, trait or item that adds to it.",
};

const maxTotal = (state: SheetSignals) => manaMax(state).total;

/** Current and Max Mana, and the button that restores it, as 8 hours of rest or enough meditation do. */
export function ManaBar() {
    const { state, actions, canEdit } = useSheet();
    const restorable = useComputed(() => canRestoreMana(state)).value;
    return (
        <Scope dataId="mana" class="layout-row">
            <label>Current Mana:
                <CurrentResource field="current" max={maxTotal} />
            </label>
            {/* Not a label: a click in its dropdown would go to the total. */}
            <span class="resource-stat">Max Mana: <StatField field="max" texts={MAX_TEXTS} fallback="0" value={manaMax} refs={MANA_REFS} /></span>
            <button type="button" data-id="restore" class="mana-restore" disabled={!canEdit || !restorable}
                title={restorable
                    ? "Restore the mana to its maximum: 8 hours of rest, or a minute of meditation for each"
                    : "Mana is not restored while a spell is sustained"}
                onClick={() => restoreMana({ state, actions })}>Max</button>
        </Scope>
    );
}

/** The mana in the stat block, under the PR. */
export function StatMana() {
    const { state } = useSheet();
    return (
        <Scope dataId="mana" class="stat-line stat-power-bar">
            <label class="stat-resource">
                Mana <CurrentResource field="current" max={maxTotal} /> / {maxTotal(state)}
            </label>
        </Scope>
    );
}

/** What a cast at `pr` costs of the mana left, a row of its roll; none while casts spend no mana. */
export function ManaRow({ pr }: { pr: number }) {
    const { state } = useSheet();
    if (!manaRule(state)) return null;
    const left = numberAt(state, MANA);
    return (
        <RollRow label="Mana" class="mana-row">
            <span data-id="manaCost" title="A cast spends its effective PR, kick included, before its test">{`${pr} of ${left}`}</span>
            {pr > left && <span class="pr-warning" data-id="noMana">Not enough to cast</span>}
        </RollRow>
    );
}
