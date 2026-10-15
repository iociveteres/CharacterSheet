// The mana of Pathfinder Crusade (state/mana.ts): the row of each pool in the
// Magic tab, the PR mana under the PR and a Focus of a half-caster class in
// the Sorcery rows (Sorcery.tsx), the pools in the stat block, and what a cast
// costs in its roll. Only the layout of Pathfinder Crusade includes them.
import type { ComponentChildren } from "preact";
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { Scope } from "../components/Scope";
import { numberAt } from "../state/sync";
import {
    MANA_REFS, currentOf, manaMax, manaRule, manaUpkeep, payUpkeep, poolName, poolNoun, restoreMana, type ManaPool,
} from "../state/mana";
import { psykanaRule } from "../state/psychic";
import { focusVariant } from "../state/sorcery";
import { poolBase } from "../state/spellcasting";
import type { StatSet } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import type { Rule } from "./BlockSettings";
import { RollRow } from "./Processes";
import { CurrentResource, StatField, type StatTexts } from "./ResourceField";

export const MANA_RULE: Rule = {
    field: "mana",
    label: "Mana",
    title: "A cast spends its effective PR of mana, kick included, before its test; without the mana it is not rolled. "
        + "A Sorcery spell spends its Level of the Focus of its class, as Bardic Focus. A sustained Upkeep (X) spell costs X a turn. "
        + "The Spellcasting ticked gives the maximum of the mana and of each Focus.",
};

const HINT = "A talent, trait or item that adds to it.";

/** What gives the maximum of `pool`: the variants of Spellcasting ticked, each with what its formula comes to (`source`). */
function poolTexts(stats: StatSet, pool: ManaPool, source: string): StatTexts {
    const variant = focusVariant(stats, pool);
    if (!variant) {
        const rule = !source ? "the PR variants of Spellcasting give it; none is ticked"
            : source.includes(";") ? `Spellcasting gives it, the largest: ${source}` : `Spellcasting gives it: ${source}`;
        return { noun: "maximum of mana", rule, hint: HINT };
    }
    return {
        noun: `maximum of ${variant.pool}`,
        rule: source ? `Spellcasting gives it: ${source}` : `${variant.label} Spellcasting gives it, ${variant.base}; it is not ticked`,
        hint: HINT,
    };
}

/**
 * `pool` as current / max, the button that restores it, as 8 hours of rest or
 * enough meditation do, and the one that pays the upkeep.
 */
export function ManaBar({ pool = "mana" }: { pool?: ManaPool }) {
    const { state, actions, canEdit, stats } = useSheet();
    const base = useComputed(() => poolBase(state, pool)).value;
    const texts = poolTexts(stats, pool, base.source);
    const name = poolName(stats, pool);
    const noun = poolNoun(stats, pool);
    const max = (s: SheetSignals) => manaMax(s, pool);
    return (
        <Scope dataId={pool} class="layout-row pool-row">
            <span class="pool-fraction">
                <label>{`${name}:`}
                    <CurrentResource field="current" max={s => max(s).total} />
                </label>
                {/* The max out of the label: a click in its dropdown would go to the current. */}
                <span class="pool-slash">/</span>
                <StatField field="max" texts={texts} fallback={base.base} value={max} refs={MANA_REFS} />
            </span>
            <button type="button" data-id="restore" class="mana-restore" disabled={!canEdit}
                title={`Restore the ${noun} to its maximum: 8 hours of rest, or a minute of meditation for each`}
                onClick={() => restoreMana({ state, actions }, pool)}>Max</button>
            <UpkeepButton pool={pool} />
        </Scope>
    );
}

function upkeepTitle(upkeep: number, left: number, noun: string) {
    if (upkeep === 0) return "No sustained spell has Upkeep (X)";
    if (upkeep > left) return `Not enough ${noun} for the upkeep: it costs ${upkeep}, ${left} left`;
    return `Pay the upkeep of the sustained spells at the start of your turn: ${upkeep} ${noun}`;
}

/**
 * Pays what the sustained Upkeep (X) spells of `pool` cost a turn. Not
 * without the mana for all of them: which to dispel then is the player's call.
 */
function UpkeepButton({ pool }: { pool: ManaPool }) {
    const { state, actions, canEdit, stats } = useSheet();
    const counted = useComputed(() => manaRule(state) && psykanaRule(state, "sustained")).value;
    const upkeep = useComputed(() => manaUpkeep(state, pool)).value;
    const left = useComputed(() => numberAt(state, currentOf(pool))).value;
    if (!counted) return null;
    return (
        <button type="button" data-id="upkeep" class="mana-upkeep" disabled={!canEdit || upkeep === 0 || upkeep > left}
            title={upkeepTitle(upkeep, left, poolNoun(stats, pool))} onClick={() => payUpkeep({ state, actions }, pool)}>{`Upkeep ${upkeep}`}</button>
    );
}

/** The mana of `pool` in the stat block: under the PR, or a Focus in the lines of Sorcery with `children`. */
export function StatMana({ pool = "mana", children }: { pool?: ManaPool; children?: ComponentChildren }) {
    const { state, stats } = useSheet();
    const max = (s: SheetSignals) => manaMax(s, pool).total;
    return (
        <Scope dataId={pool} class="stat-line stat-power-bar">
            <label class="stat-resource">
                {poolName(stats, pool)} <CurrentResource field="current" max={max} /> / {max(state)}
            </label>
            {children}
        </Scope>
    );
}

/** What a cast costs of the mana left in `pool`, a row of its roll; none while casts spend no mana. */
export function ManaRow({ cost, pool = "mana" }: { cost: number; pool?: ManaPool }) {
    const { state, stats } = useSheet();
    if (!manaRule(state)) return null;
    const left = numberAt(state, currentOf(pool));
    const name = poolName(stats, pool);
    return (
        <RollRow label={name} class="mana-row">
            <span data-id="manaCost" title={pool === "mana"
                ? "A cast spends its effective PR, kick included, before its test"
                : `A Sorcery spell spends its Level of the ${name} before its test`}>{`${cost} of ${left}`}</span>
            {cost > left && <span class="pr-warning" data-id="noMana">Not enough to cast</span>}
        </RollRow>
    );
}
