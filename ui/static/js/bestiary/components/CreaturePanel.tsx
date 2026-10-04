// The right panel: the selected creature and its stat block. The sheet draws
// the block in a shadow root of its own, as in the encounter; "Edit" opens
// the full sheet over the page.
import { useRef } from "preact/hooks";
import type { Creature } from "../types.gen";
import { creatureSheet, kindLabel, selectedCollection, shownCreature } from "../state";
import { openCreatureSheet } from "../actions";
import { renderStatBlockView } from "../../sheet/view";
import { useSheetView } from "../../sheet/useSheetView";

export function CreaturePanel() {
    const creature = shownCreature.value;
    return (
        <section class="bestiary-panel bestiary-creature" aria-label="Creature">
            <div class="bestiary-panel-body">
                {creature
                    ? <CreatureView key={creature.id} creature={creature} />
                    : <p class="bestiary-muted">Pick a creature to see its stat block.</p>}
            </div>
        </section>
    );
}

function CreatureView({ creature }: { creature: Creature }) {
    const { id } = creature;
    const box = useRef<HTMLDivElement>(null);
    const sheet = creatureSheet.value;
    useSheetView(box, sheet, renderStatBlockView);
    // The creature of another user's collection is only read and rolled; its row in the collection copies it out.
    const own = selectedCollection.value?.own ?? true;
    return (
        <div class="bestiary-creature-view" data-creature-id={id}>
            <div class="bestiary-header">
                <h2 class="bestiary-title">{creature.name}</h2>
                <button type="button" class="bestiary-open-sheet" disabled={!sheet} onClick={openCreatureSheet}>
                    {own ? "Edit" : "View"}
                </button>
            </div>
            {creature.sourceLabel && <div class="bestiary-muted bestiary-source">Source: {creature.sourceLabel}</div>}
            <div class="bestiary-muted">{kindLabel(creature.kind)}</div>
            {sheet
                ? <div class="bestiary-statblock" ref={box} />
                : <p class="bestiary-muted">…</p>}
        </div>
    );
}
