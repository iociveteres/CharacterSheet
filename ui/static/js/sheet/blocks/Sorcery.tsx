// Sorcery spells of half-casters (state/sorcery.ts) on a spell card: the chip
// of the way after its name, the Level by its Subtypes and the line of the
// type under its ⚙. A Black Crusade sheet has no Sorcery spells (hasSorcery).
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { NumberField } from "../components/fields";
import { isSorcery, powerTraitsAt } from "../state/psychic";
import { sorceryCost } from "../state/sorcery";
import { Row } from "./Attacks";

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
