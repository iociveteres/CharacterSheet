// The mana of Pathfinder Crusade (state/mana.ts): its row under the PR of the
// Magic tab and of the stat block, and what a cast costs in its roll. Only the layout of Pathfinder Crusade includes them.
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { Scope } from "../components/Scope";
import { numberAt } from "../state/sync";
import { MANA, MANA_REFS, canRestoreMana, currentOf, manaMax, manaRule, manaUpkeep, payUpkeep, restoreMana, type ManaPool } from "../state/mana";
import { psykanaRule } from "../state/psychic";
import type { SheetSignals } from "../schema/sheet";
import type { Rule } from "./BlockSettings";
import { RollRow } from "./Processes";
import { CurrentResource, StatField, type StatTexts } from "./ResourceField";

export const MANA_RULE: Rule = {
    field: "mana",
    label: "Mana",
    title: "A cast spends its effective PR of mana, kick included, before its test; without the mana it is not rolled. "
        + "A sustained Upkeep (X) spell costs X a turn.",
};

const MAX_TEXTS: StatTexts = {
    noun: "maximum of mana",
    rule: "the trait Caster of the class gives it",
    hint: "A talent, trait or item that adds to it.",
};

const maxTotal = (state: SheetSignals) => manaMax(state).total;

/** Current and Max Mana, the button that restores it, as 8 hours of rest or enough meditation do, and the one that pays the upkeep. */
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
            <UpkeepButton />
        </Scope>
    );
}

function upkeepTitle(upkeep: number, left: number) {
    if (upkeep === 0) return "No sustained spell has Upkeep (X)";
    if (upkeep > left) return `Not enough mana for the upkeep: it costs ${upkeep}, ${left} left`;
    return `Pay the upkeep of the sustained spells at the start of your turn: ${upkeep} mana`;
}

/**
 * Pays what the sustained Upkeep (X) spells cost a turn. Not without the mana
 * for all of them: which to dispel then is the player's call.
 */
function UpkeepButton() {
    const { state, actions, canEdit } = useSheet();
    const counted = useComputed(() => manaRule(state) && psykanaRule(state, "sustained")).value;
    const upkeep = useComputed(() => manaUpkeep(state)).value;
    const left = useComputed(() => numberAt(state, MANA)).value;
    if (!counted) return null;
    return (
        <button type="button" data-id="upkeep" class="mana-upkeep" disabled={!canEdit || upkeep === 0 || upkeep > left}
            title={upkeepTitle(upkeep, left)} onClick={() => payUpkeep({ state, actions })}>{`Upkeep ${upkeep}`}</button>
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

/** What a cast costs of the mana left in `pool`, a row of its roll; none while casts spend no mana. */
export function ManaRow({ cost, pool = "mana" }: { cost: number; pool?: ManaPool }) {
    const { state } = useSheet();
    if (!manaRule(state)) return null;
    const left = numberAt(state, currentOf(pool));
    return (
        <RollRow label={pool === "mana" ? "Mana" : "Sorcery mana"} class="mana-row">
            <span data-id="manaCost" title={pool === "mana"
                ? "A cast spends its effective PR, kick included, before its test"
                : "A Sorcery spell spends its Level of the Sorcery mana before its test"}>{`${cost} of ${left}`}</span>
            {cost > left && <span class="pr-warning" data-id="noMana">Not enough to cast</span>}
        </RollRow>
    );
}
