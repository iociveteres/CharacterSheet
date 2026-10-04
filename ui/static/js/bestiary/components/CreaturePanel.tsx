// The right panel: the selected creature and its stat block. The sheet draws
// the block in a shadow root of its own, as in the encounter; a click on the
// block outside its controls opens the full sheet over the page.
import { useRef } from "preact/hooks";
import type { JSX } from "preact";
import type { Creature } from "../types.gen";
import { creatureSheet, kindLabel, selectedCollection, selectedCreature } from "../state";
import { deleteCreature, openCreatureSheet, openDialog } from "../actions";
import { creatureExportUrl } from "../api";
import { renderStatBlockView } from "../../sheet/view";
import { useSheetView } from "../../sheet/useSheetView";
import { Menu, MenuItem, Tags } from "./common";

export function CreaturePanel() {
    const creature = selectedCreature.value;
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

// What a click in the stat block works by itself: a roll, a field, a link.
const CONTROLS = "button, input, select, textarea, a, label, [data-id=\"roll\"]";

/** A click on the stat block that hit none of its controls; the block is in a shadow root, so the path is read. */
function openOnBlockClick(e: JSX.TargetedMouseEvent<HTMLDivElement>): void {
    for (const el of e.composedPath()) {
        if (el === e.currentTarget) break;
        if (el instanceof Element && el.matches(CONTROLS)) return;
    }
    openCreatureSheet();
}

function CreatureView({ creature }: { creature: Creature }) {
    const { id } = creature;
    const box = useRef<HTMLDivElement>(null);
    const sheet = creatureSheet.value;
    useSheetView(box, sheet, renderStatBlockView);
    // The creature of another user's collection is only read, rolled, copied out and exported.
    const own = selectedCollection.value?.own ?? true;
    return (
        <div class="bestiary-creature-view" data-creature-id={id}>
            <div class="bestiary-header">
                <h2 class="bestiary-title">{creature.name}</h2>
                <button type="button" class="bestiary-open-sheet" disabled={!sheet} onClick={openCreatureSheet}>
                    {own ? "Edit" : "Open sheet"}
                </button>
                {own
                    ? <Menu label="Creature menu" class="bestiary-creature-menu">
                        <MenuItem onClick={() => openDialog({ type: "creature", field: "name", id })}>Rename</MenuItem>
                        <MenuItem onClick={() => openDialog({ type: "creature", field: "tags", id })}>Tags</MenuItem>
                        <MenuItem onClick={() => openDialog({ type: "copy", id })}>Copy to…</MenuItem>
                        <MenuItem onClick={() => openDialog({ type: "move", id })}>Move to…</MenuItem>
                        <a role="menuitem" class="bestiary-menu-item" href={creatureExportUrl(id)} download>Export</a>
                        <MenuItem danger onClick={() => void deleteCreature(id)}>Delete</MenuItem>
                    </Menu>
                    : <>
                        <button type="button" class="bestiary-copy-to-mine" onClick={() => openDialog({ type: "copy", id })}>
                            Copy to my collection…
                        </button>
                        <a class="bestiary-export" href={creatureExportUrl(id)} download>Export</a>
                    </>}
            </div>
            {creature.sourceLabel && <div class="bestiary-muted bestiary-source">Source: {creature.sourceLabel}</div>}
            <div class="bestiary-muted">{kindLabel(creature.kind)}</div>
            <Tags tags={creature.tags} />
            {sheet
                ? <div class="bestiary-statblock" ref={box} title="Click to open the sheet" onClick={openOnBlockClick} />
                : <p class="bestiary-muted">…</p>}
        </div>
    );
}
