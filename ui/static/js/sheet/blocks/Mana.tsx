// The mana of Pathfinder Crusade (state/mana.ts): the row of each pool in the
// Magic tab, the PR mana under the PR and the Halfcasting Mana in the Sorcery row
// (Sorcery.tsx), the mana in the stat block, and what a cast costs in its
// roll. Only the layout of Pathfinder Crusade includes them.
import type { ComponentChildren } from "preact";
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { Scope } from "../components/Scope";
import { numberAt } from "../state/sync";
import {
    MANA_REFS, canRestoreMana, currentOf, manaMax, manaRule, manaUpkeep, payUpkeep, poolName, restoreMana, type ManaPool,
} from "../state/mana";
import { psykanaRule } from "../state/psychic";
import type { SheetSignals } from "../schema/sheet";
import type { Rule } from "./BlockSettings";
import { RollRow } from "./Processes";
import { CurrentResource, StatField, type StatTexts } from "./ResourceField";

export const MANA_RULE: Rule = {
    field: "mana",
    label: "Mana",
    title: "A cast spends its effective PR of mana, kick included, before its test; without the mana it is not rolled. "
        + "A Sorcery spell spends its Level of the Halfcasting Mana. A sustained Upkeep (X) spell costs X a turn.",
};

// What spells each pool is of and what gives its maximum.
const POOLS: { [P in ManaPool]: { spells: string; texts: StatTexts } } = {
    mana: {
        spells: "a spell",
        texts: { noun: "maximum of mana", rule: "the trait Caster of the class gives it", hint: "A talent, trait or item that adds to it." },
    },
    sorceryMana: {
        spells: "a Sorcery spell",
        texts: {
            noun: "maximum of Halfcasting Mana",
            rule: "the class gives it: F.b for a bard, P.b for a ranger",
            hint: "A talent, trait or item that adds to it.",
        },
    },
};

/**
 * Current and Max Mana of `pool`, the button that restores it, as 8 hours of
 * rest or enough meditation do, and the one that pays the upkeep.
 */
export function ManaBar({ pool = "mana" }: { pool?: ManaPool }) {
    const { state, actions, canEdit } = useSheet();
    const restorable = useComputed(() => canRestoreMana(state, pool)).value;
    const { spells, texts } = POOLS[pool];
    const noun = poolName(pool);
    const max = (s: SheetSignals) => manaMax(s, pool);
    return (
        <Scope dataId={pool} class="layout-row">
            <label>{`Current ${noun}:`}
                <CurrentResource field="current" max={s => max(s).total} />
            </label>
            {/* Not a label: a click in its dropdown would go to the total. */}
            <span class="resource-stat">{`Max ${noun}:`} <StatField field="max" texts={texts} fallback="0" value={max} refs={MANA_REFS} /></span>
            <button type="button" data-id="restore" class="mana-restore" disabled={!canEdit || !restorable}
                title={restorable
                    ? `Restore the ${noun.toLowerCase()} to its maximum: 8 hours of rest, or a minute of meditation for each`
                    : `${noun} is not restored while ${spells} is sustained`}
                onClick={() => restoreMana({ state, actions }, pool)}>Max</button>
            <UpkeepButton pool={pool} />
        </Scope>
    );
}

function upkeepTitle(upkeep: number, left: number, pool: ManaPool) {
    if (upkeep === 0) return "No sustained spell has Upkeep (X)";
    if (upkeep > left) return `Not enough ${poolName(pool).toLowerCase()} for the upkeep: it costs ${upkeep}, ${left} left`;
    return `Pay the upkeep of the sustained spells at the start of your turn: ${upkeep} mana`;
}

/**
 * Pays what the sustained Upkeep (X) spells of `pool` cost a turn. Not
 * without the mana for all of them: which to dispel then is the player's call.
 */
function UpkeepButton({ pool }: { pool: ManaPool }) {
    const { state, actions, canEdit } = useSheet();
    const counted = useComputed(() => manaRule(state) && psykanaRule(state, "sustained")).value;
    const upkeep = useComputed(() => manaUpkeep(state, pool)).value;
    const left = useComputed(() => numberAt(state, currentOf(pool))).value;
    if (!counted) return null;
    return (
        <button type="button" data-id="upkeep" class="mana-upkeep" disabled={!canEdit || upkeep === 0 || upkeep > left}
            title={upkeepTitle(upkeep, left, pool)} onClick={() => payUpkeep({ state, actions }, pool)}>{`Upkeep ${upkeep}`}</button>
    );
}

/** The mana of `pool` in the stat block: under the PR, or in the line of Sorcery with `children`. */
export function StatMana({ pool = "mana", children }: { pool?: ManaPool; children?: ComponentChildren }) {
    const { state } = useSheet();
    const max = (s: SheetSignals) => manaMax(s, pool).total;
    return (
        <Scope dataId={pool} class="stat-line stat-power-bar">
            <label class="stat-resource">
                {poolName(pool)} <CurrentResource field="current" max={max} /> / {max(state)}
            </label>
            {children}
        </Scope>
    );
}

/** What a cast costs of the mana left in `pool`, a row of its roll; none while casts spend no mana. */
export function ManaRow({ cost, pool = "mana" }: { cost: number; pool?: ManaPool }) {
    const { state } = useSheet();
    if (!manaRule(state)) return null;
    const left = numberAt(state, currentOf(pool));
    return (
        <RollRow label={poolName(pool)} class="mana-row">
            <span data-id="manaCost" title={pool === "mana"
                ? "A cast spends its effective PR, kick included, before its test"
                : "A Sorcery spell spends its Level of the Halfcasting Mana before its test"}>{`${cost} of ${left}`}</span>
            {cost > left && <span class="pr-warning" data-id="noMana">Not enough to cast</span>}
        </RollRow>
    );
}
