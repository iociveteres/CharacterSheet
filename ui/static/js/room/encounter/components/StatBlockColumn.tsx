// The fourth column of the encounter window: the participant picked in the
// others, with the stat block of their sheet. The room draws the header; the
// sheet draws the stat block in a shadow root of its own, like the popup.
import { useRef } from "preact/hooks";
import { participants, selected, type ParticipantView } from "../state";
import { openPopup } from "../actions";
import { renderStatBlockView } from "../../../sheet/view";
import { useSheetView } from "../../../sheet/useSheetView";

export function StatBlockColumn() {
    const picked = participants.value.find(p => p.participant.id === selected.value);
    return (
        <div class="encounter-column statblock-column" data-column="statblock">
            <div class="encounter-column-body">
                {picked
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
                <button type="button" class="encounter-open-sheet" title="Open the sheet" aria-label="Open the sheet"
                    disabled={!sheet} onClick={() => openPopup(participant.sheetId)}>↗</button>
            </div>
            {participant.displayName && <div class="encounter-card-shown-as">for players: {participant.displayName}</div>}
            {participant.sourceLabel && <div class="encounter-muted statblock-source">Source: {participant.sourceLabel}</div>}
            {sheet ? <div class="statblock-body" ref={box} /> : <p class="encounter-muted">…</p>}
        </div>
    );
}
