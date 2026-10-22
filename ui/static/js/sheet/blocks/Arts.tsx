// Arts spells of half-casters (state/arts.ts): on a spell card the chip
// of the way after its name, the Level by its Subtypes and the line of the
// type under its ⚙; in the Magic tab the rows of the Focus pools and of the
// sustained ones, in the stat block their lines. A Black Crusade sheet has no
// Arts spells (hasArts).
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { NumberField } from "../components/fields";
import { poolName } from "../state/mana";
import { psykanaRule } from "../state/psychic";
import { focusPools, hasArtsSpell, showsFocus, artsClass, artsCost, artsPool, artsSustained } from "../state/arts";
import { Row } from "./Attacks";
import { ManaBar, StatMana } from "./Mana";

/** The class of the Arts spell at `path`; null for a spell cast by PR. */
export function useArtsClass(path: string): string | null {
    const { state } = useSheet();
    return useComputed(() => artsClass(state, path)).value;
}

/** «Bard, 1 Focus»: the class of an Arts spell and what a cast costs; the class alone without a Level. */
export function ArtsChip({ path }: { path: string }) {
    const { state, stats, terms } = useSheet();
    const cls = useArtsClass(path);
    const level = useComputed(() => artsCost(state, path)).value;
    const pool = useComputed(() => artsPool(state, path)).value;
    if (cls === null) return null;
    return (
        <span class="arts-chip" data-id="artsChip"
            title={`An Arts ${terms.power} of the ${cls}: tested on a skill, it costs its Level of the ${pool ? poolName(stats, pool) : `${cls} Focus`}`}>
            {level > 0 ? `${cls}, ${level} Focus` : cls}
        </span>
    );
}

/** The Level of an Arts spell, the level of the talent it is and its mana cost. */
export function ArtsLevel({ path }: { path: string }) {
    if (useArtsClass(path) === null) return null;
    return (
        <Row cls="level" label="Level:">
            <NumberField field="level" class="short" title="The level of the talent the spell is: a cast costs as much mana" />
        </Row>
    );
}

/** The line of the type Arts (X) under the ⚙ of a spell. */
export function ArtsTrait({ path }: { path: string }) {
    const artsClass = useArtsClass(path);
    if (artsClass === null) return null;
    return <li data-id="artsTrait">{`Arts (${artsClass}): tested on a skill, ePR by its level, costs its Level, no phenomena`}</li>;
}

/** How many Arts spells are sustained of the limit, 1 or 2 with Expanded Sustain. */
function ArtsSustainedCount() {
    const { state } = useSheet();
    const { count, limit } = useComputed(() => artsSustained(state)).value;
    const over = count > limit;
    return (
        <span class={over ? "prepared-count over" : "prepared-count"} data-id="artsSustained"
            title={over ? `More Arts spells sustained than the limit: ${limit}` : "One sustained at most of all classes, two with the talent Expanded Sustain"}>
            {`Arts sustained: ${count} / ${limit}`}
        </span>
    );
}

/** The Focus pools the sheet shows: those of the variants ticked and those its Arts spells pay from. */
function useFocusPools() {
    const { state, stats } = useSheet();
    return useComputed(() => focusPools(stats).filter(pool => showsFocus(state, pool))).value;
}

/**
 * The rows of Arts in the Magic tab: a Focus pool per Arts variant
 * ticked or class the sheet has a spell of, in columns, and under them the
 * sustained ones, while it has any of them or an Arts spell.
 */
export function ArtsBar() {
    const { state } = useSheet();
    const pools = useFocusPools();
    const shown = useComputed(() => hasArtsSpell(state)).value || pools.length > 0;
    const counted = useComputed(() => psykanaRule(state, "sustained")).value;
    if (!shown) return null;
    return (
        <>
            {pools.length > 0 && <div class="focus-pools">{pools.map(pool => <ManaBar key={pool} pool={pool} />)}</div>}
            {counted && <div class="layout-row"><ArtsSustainedCount /></div>}
        </>
    );
}

/** The lines of Arts in the stat block, a Focus pool's each, as the Magic tab shows them; the sustained ones on the last. */
export function StatArts() {
    const { state } = useSheet();
    const pools = useFocusPools();
    const shown = useComputed(() => hasArtsSpell(state)).value || pools.length > 0;
    const counted = useComputed(() => psykanaRule(state, "sustained")).value;
    if (!shown) return null;
    if (pools.length === 0) return counted ? <div class="stat-line stat-power-bar"><ArtsSustainedCount /></div> : null;
    return (
        <>
            {pools.map((pool, i) => (
                <StatMana key={pool} pool={pool}>
                    {counted && i === pools.length - 1 && <ArtsSustainedCount />}
                </StatMana>
            ))}
        </>
    );
}
