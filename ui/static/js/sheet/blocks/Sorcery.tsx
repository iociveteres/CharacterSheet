// Sorcery spells of half-casters (state/sorcery.ts): on a spell card the chip
// of the way after its name, the Level by its Subtypes and the line of the
// type under its ⚙; in the Magic tab the row of the Sorcery mana and of the
// sustained ones. A Black Crusade sheet has no Sorcery spells (hasSorcery).
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { NumberField } from "../components/fields";
import { isSorcery, powerTraitsAt, psykanaRule } from "../state/psychic";
import { hasSorcerySpell, sorceryCost, sorcerySustained } from "../state/sorcery";
import { Row } from "./Attacks";
import { ManaBar } from "./Mana";

export const SORCERY_NOTICE = "A spell typed Sorcery (Bard) in its Subtypes is cast by a half-caster: tested on a skill, "
    + "its ePR at most the level of that skill, it costs its Level of the Sorcery mana and has no phenomena.";

/** The class of the Sorcery spell at `path`; null for a spell cast by PR. */
export function useSorceryClass(path: string): string | null {
    const { state } = useSheet();
    return useComputed(() => (isSorcery(state, path) ? powerTraitsAt(state, path).sorcery! : null)).value;
}

/** «Bard, 1 mana»: the class of a Sorcery spell and what a cast costs; the class alone without a Level. */
export function SorceryChip({ path }: { path: string }) {
    const { state, terms } = useSheet();
    const sorceryClass = useSorceryClass(path);
    const level = useComputed(() => sorceryCost(state, path)).value;
    if (sorceryClass === null) return null;
    return (
        <span class="sorcery-chip" data-id="sorceryChip"
            title={`A Sorcery ${terms.power} of the ${sorceryClass}: tested on a skill, it costs its Level of the Sorcery mana`}>
            {level > 0 ? `${sorceryClass}, ${level} mana` : sorceryClass}
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
            title={over ? `More Sorcery spells sustained than the limit: ${limit}` : "One sustained at most, two with the talent Expanded Sustain"}>
            {`Sustained: ${count} / ${limit}`}
        </span>
    );
}

/** The row of Sorcery in the Magic tab, while the sheet has a Sorcery spell: its mana and the sustained ones. */
export function SorceryBar() {
    const { state } = useSheet();
    const shown = useComputed(() => hasSorcerySpell(state)).value;
    const counted = useComputed(() => psykanaRule(state, "sustained")).value;
    if (!shown) return null;
    return (
        <ManaBar pool="sorceryMana">
            {counted && <SorcerySustainedCount />}
        </ManaBar>
    );
}
