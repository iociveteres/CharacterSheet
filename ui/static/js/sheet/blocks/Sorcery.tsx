// Sorcery spells of half-casters (state/sorcery.ts): on a spell card the chip
// of the way after its name, the Level by its Subtypes and the line of the
// type under its ⚙; in the Magic tab the rows of the Focus pools and of the
// sustained ones, in the stat block their lines. A Black Crusade sheet has no
// Sorcery spells (hasSorcery).
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { NumberField } from "../components/fields";
import { poolName } from "../state/mana";
import { psykanaRule } from "../state/psychic";
import { focusPools, hasSorcerySpell, hasSorcerySpellOf, sorceryClass, sorceryCost, sorceryPool, sorcerySustained } from "../state/sorcery";
import { Row } from "./Attacks";
import { ManaBar, StatMana } from "./Mana";

export const SORCERY_NOTICE = "A spell typed Sorcery (Bard) in its Subtypes is cast by a half-caster: tested on a skill, "
    + "its ePR at most the level of that skill, it costs its Level of the Focus of its class, as Bardic Focus, and has no phenomena.";

/** The class of the Sorcery spell at `path`; null for a spell cast by PR. */
export function useSorceryClass(path: string): string | null {
    const { state } = useSheet();
    return useComputed(() => sorceryClass(state, path)).value;
}

/** «Bard, 1 Focus»: the class of a Sorcery spell and what a cast costs; the class alone without a Level. */
export function SorceryChip({ path }: { path: string }) {
    const { state, stats, terms } = useSheet();
    const cls = useSorceryClass(path);
    const level = useComputed(() => sorceryCost(state, path)).value;
    const pool = useComputed(() => sorceryPool(state, path)).value;
    if (cls === null) return null;
    return (
        <span class="sorcery-chip" data-id="sorceryChip"
            title={`A Sorcery ${terms.power} of the ${cls}: tested on a skill, it costs its Level of the ${pool ? poolName(stats, pool) : `${cls} Focus`}`}>
            {level > 0 ? `${cls}, ${level} Focus` : cls}
        </span>
    );
}

/** The Level of a Sorcery spell, the level of the talent it is and its mana cost. */
export function SorceryLevel({ path }: { path: string }) {
    if (useSorceryClass(path) === null) return null;
    return (
        <Row cls="level" label="Level:">
            <NumberField field="level" class="short" title="The level of the talent the spell is: a cast costs as much mana" />
        </Row>
    );
}

/** The line of the type Sorcery (X) under the ⚙ of a spell. */
export function SorceryTrait({ path }: { path: string }) {
    const sorceryClass = useSorceryClass(path);
    if (sorceryClass === null) return null;
    return <li data-id="sorceryTrait">{`Sorcery (${sorceryClass}): tested on a skill, ePR by its level, costs its Level, no phenomena`}</li>;
}

/** How many Sorcery spells are sustained of the limit, 1 or 2 with Expanded Sustain. */
function SorcerySustainedCount() {
    const { state } = useSheet();
    const { count, limit } = useComputed(() => sorcerySustained(state)).value;
    const over = count > limit;
    return (
        <span class={over ? "prepared-count over" : "prepared-count"} data-id="sorcerySustained"
            title={over ? `More Sorcery spells sustained than the limit: ${limit}` : "One sustained at most of all classes, two with the talent Expanded Sustain"}>
            {`Sorcery sustained: ${count} / ${limit}`}
        </span>
    );
}

/** The Focus pools the sheet shows: those its Sorcery spells pay from. */
function useFocusPools() {
    const { state, stats } = useSheet();
    return useComputed(() => focusPools(stats).filter(pool => hasSorcerySpellOf(state, pool))).value;
}

/**
 * The rows of Sorcery in the Magic tab: a Focus pool per class the sheet has
 * a Sorcery spell of, and under them the sustained ones, while it has any.
 */
export function SorceryBar() {
    const { state } = useSheet();
    const pools = useFocusPools();
    const shown = useComputed(() => hasSorcerySpell(state)).value;
    const counted = useComputed(() => psykanaRule(state, "sustained")).value;
    if (!shown) return null;
    return (
        <>
            {pools.map(pool => <ManaBar key={pool} pool={pool} />)}
            {counted && <div class="layout-row"><SorcerySustainedCount /></div>}
        </>
    );
}

/** The lines of Sorcery in the stat block, a Focus pool's each, while the sheet has a Sorcery spell; the sustained ones on the last. */
export function StatSorcery() {
    const { state } = useSheet();
    const pools = useFocusPools();
    const shown = useComputed(() => hasSorcerySpell(state)).value;
    const counted = useComputed(() => psykanaRule(state, "sustained")).value;
    if (!shown) return null;
    if (pools.length === 0) return counted ? <div class="stat-line stat-power-bar"><SorcerySustainedCount /></div> : null;
    return (
        <>
            {pools.map((pool, i) => (
                <StatMana key={pool} pool={pool}>
                    {counted && i === pools.length - 1 && <SorcerySustainedCount />}
                </StatMana>
            ))}
        </>
    );
}
