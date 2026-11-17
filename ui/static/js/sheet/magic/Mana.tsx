// The mana of Pathfinder Crusade (magic/manaRules.ts): the row of each pool in the
// Magic tab, the PR mana under the PR and a Focus of a half-caster class in
// the Arts rows (Arts.tsx), the pools in the stat block, and what a cast
// costs in its roll. Only the layout of Pathfinder Crusade includes them.
import type { ComponentChildren } from "preact";
import { useComputed } from "@preact/signals";
import { t } from "../../i18n";
import { useSheet } from "../components/context";
import { Scope } from "../components/Scope";
import { numberAt } from "../core/sync";
import {
    MANA_REFS, currentOf, manaMax, manaRule, manaUpkeep, payUpkeep, poolName, restoreMana,
} from "./manaRules";
import { psykanaRule } from "./psychic";
import { focusVariant } from "./artsRules";
import { poolBase } from "./spellcastingRules";
import type { StatSet } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import type { ManaPool, Rule } from "../components/kindParts";
import { RollRow } from "../rolls/rollParts";
import { CurrentResource, StatField, type StatTexts } from "../rolls/ResourceField";

export const MANA_RULE: Rule = {
    field: "mana",
    label: t("sheet.termsPf.magic.mana"),
    title: t("sheet.magicPf.mana.ruleTitle"),
};

const HINT = t("sheet.magicPf.mana.hint");

/** What gives the maximum of `pool`: the variants of Spellcasting ticked, each with what its formula comes to (`source`). */
function poolTexts(stats: StatSet, pool: ManaPool, source: string): StatTexts {
    const variant = focusVariant(stats, pool);
    if (!variant) {
        const rule = !source ? t("sheet.magicPf.mana.ruleNone")
            : source.includes(";") ? t("sheet.magicPf.mana.ruleLargest", { source }) : t("sheet.magicPf.mana.ruleSource", { source });
        return { noun: t("sheet.magicPf.mana.maxNoun"), rule, hint: HINT };
    }
    return {
        noun: t("sheet.magicPf.mana.maxNounPool", { pool: variant.pool ?? "" }),
        rule: source ? t("sheet.magicPf.mana.ruleSource", { source }) : t("sheet.magicPf.mana.ruleUnticked", { trait: variant.trait, base: variant.base }),
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
                title={pool === "mana" ? t("sheet.magicPf.mana.restoreTitle") : t("sheet.magicPf.mana.restoreTitlePool", { pool: name })}
                onClick={() => restoreMana({ state, actions }, pool)}>{t("sheet.magic.pr.max")}</button>
            <UpkeepButton pool={pool} />
        </Scope>
    );
}

function upkeepTitle(upkeep: number, left: number, pool: ManaPool, name: string) {
    if (upkeep === 0) return t("sheet.magicPf.mana.upkeepNone");
    if (upkeep > left) {
        return pool === "mana" ? t("sheet.magicPf.mana.upkeepShort", { upkeep, left }) : t("sheet.magicPf.mana.upkeepShortPool", { pool: name, upkeep, left });
    }
    return pool === "mana" ? t("sheet.magicPf.mana.upkeepPay", { upkeep }) : t("sheet.magicPf.mana.upkeepPayPool", { pool: name, upkeep });
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
            title={upkeepTitle(upkeep, left, pool, poolName(stats, pool))}
            onClick={() => payUpkeep({ state, actions }, pool)}>{t("sheet.magicPf.mana.upkeep", { upkeep })}</button>
    );
}

/** The mana of `pool` in the stat block: under the PR, or a Focus in the lines of Arts with `children`. */
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
            <span data-id="manaCost" title={pool === "mana" ? t("sheet.magicPf.mana.costTitle") : t("sheet.magicPf.mana.costTitlePool", { pool: name })}>
                {t("sheet.magicPf.mana.cost", { cost, left })}
            </span>
            {cost > left && <span class="pr-warning" data-id="noMana">{t("sheet.magicPf.mana.notEnough")}</span>}
        </RollRow>
    );
}
