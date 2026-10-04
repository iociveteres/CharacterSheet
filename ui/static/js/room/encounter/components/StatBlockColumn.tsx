// The fourth column of the encounter window: the participant picked in the
// others, with the stat block of their sheet, or the creature previewed in
// "Add monsters". The room draws the header; the sheet draws the stat block
// in a shadow root of its own, like the popup.
import { useRef } from "preact/hooks";
import { participants, previewed, selected, type ParticipantView } from "../state";
import { openPopup } from "../actions";
import { openSaveToCollection } from "../../bestiary/actions";
import { renderStatBlockView } from "../../../sheet/view";
import { useSheetView } from "../../../sheet/useSheetView";
import { CreaturePreview } from "./AddMonsters";

export function StatBlockColumn() {
    const picked = participants.value.find(p => p.participant.id === selected.value);
    const creature = previewed.value;
    return (
        <div class="encounter-column statblock-column" data-column="statblock">
            <div class="encounter-column-body">
                {creature
                    ? <CreaturePreview key={creature.id} creature={creature} />
                    : picked
                    ? <Picked key={picked.participant.id} p={picked} />
                    : <p class="encounter-muted">Pick a participant to see their stat block.</p>}
            </div>
        </div>
    );
}

function Picked({ p }: { p: ParticipantView }) {
    const { participant, sheet } = p;
    const box = useRef<HTMLDivElement>(null);
    useSheetView(box, sheet, renderStatBlockView);
    return (
        <div class="statblock-picked" data-participant-id={participant.id} data-sheet-id={participant.sheetId}>
            <div class="statblock-header">
                <span class="statblock-name">{p.name}</span>
                <span class="spacer" />
                {participant.npc && (
                    <button type="button" class="encounter-icon encounter-save-to-collection" title="Save to collection" aria-label="Save to collection"
                        onClick={() => openSaveToCollection(participant.sheetId, p.name)}><FloppyIcon /></button>
                )}
                <button type="button" class="encounter-icon encounter-open-sheet" title="Open the sheet" aria-label="Open the sheet"
                    disabled={!sheet} onClick={() => openPopup(participant.sheetId)}>↗</button>
            </div>
            {participant.displayName && <div class="encounter-card-shown-as">for players: {participant.displayName}</div>}
            {participant.sourceLabel && <div class="encounter-muted statblock-source">Source: {participant.sourceLabel}</div>}
            {sheet ? <div class="statblock-body" ref={box} /> : <p class="encounter-muted">…</p>}
        </div>
    );
}

/** A diskette drawn in lines of the text's colour, as plain as the dice of the roll cursor (img/dice-cursor.svg). */
function FloppyIcon() {
    return (
        <svg class="encounter-icon-svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
            stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">
            <path d="M2.5 2.5h9l2 2v9h-11z" />
            <path d="M5 2.5v3h5.5v-3" />
            <rect x="4.5" y="8.5" width="7" height="5" />
        </svg>
    );
}
