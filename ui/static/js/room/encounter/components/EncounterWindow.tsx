// The encounter window of GM mode, in place of the sheet (islands.tsx): the
// turn order, the characters, the NPCs and the stat block of the one picked;
// the sheet of a participant opens over it. Only the gamemaster has it.
import { useState } from "preact/hooks";
import { addSheetsOpen, encounter, encounterList, fromBestiaryOpen, popupSheetId, sheetOf } from "../state";
import { addSheets, closePopup, setAddSheetsOpen } from "../actions";
import { InitiativeColumn } from "./InitiativeColumn";
import { ParticipantColumn } from "./ParticipantColumn";
import { StatBlockColumn } from "./StatBlockColumn";
import { FromBestiary } from "./FromBestiary";
import { closeOnOverlay, useEscape } from "../../components/overlay";
import { SheetPopup } from "../../components/SheetPopup";
import { players, sheets } from "../../state";
import { sheetName } from "../../characters";

export function EncounterWindow() {
    if (!encounterList.value) return null;
    const state = encounter.value;
    return (
        <div class="encounter-window" data-encounter-id={state?.id}>
            <InitiativeColumn />
            {state ? (
                <>
                    <ParticipantColumn npc={false} />
                    <ParticipantColumn npc />
                    <StatBlockColumn />
                </>
            ) : (
                <div class="encounter-column encounter-none">
                    <p class="encounter-muted">No encounter is open. Create one in the menu of the first column.</p>
                </div>
            )}
            {addSheetsOpen.value && state && <AddSheets />}
            {fromBestiaryOpen.value && state && <FromBestiary />}
            {popupSheetId.value && <SheetPopup sheet={sheetOf(Number(popupSheetId.value))} close={closePopup} />}
        </div>
    );
}

/** The sheets of the room to add as characters, hidden ones too: the gamemaster sees them all. */
function AddSheets() {
    const [picked, setPicked] = useState<number[]>([]);
    const close = () => setAddSheetsOpen(false);
    useEscape(close);
    const added = new Set(encounter.value?.participants.map(p => p.sheetId));
    const ownerName = (id: number) => players.value.find(p => p.id === id)?.name ?? "";
    const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter(p => p !== id) : [...picked, id]);
    return (
        <div class="overlay open" onClick={closeOnOverlay(close)}>
            <div class="modal layout-column encounter-add-sheets-modal" role="dialog" aria-modal="true" aria-label="Add sheets">
                <h3>Add sheets</h3>
                <div class="encounter-sheet-list">
                    {sheets.value.map(s => (
                        <label key={s.id} class={added.has(s.id) ? "layout-row encounter-muted" : "layout-row"}>
                            <input type="checkbox" data-sheet-id={s.id} disabled={added.has(s.id)}
                                checked={added.has(s.id) || picked.includes(s.id)} onChange={() => toggle(s.id)} />
                            <span>{sheetName(s)}</span>
                            <span class="encounter-muted">{ownerName(s.ownerId)}</span>
                        </label>
                    ))}
                    {!sheets.value.length && <p class="encounter-muted">The room has no sheets.</p>}
                </div>
                <div class="actions">
                    <button type="button" class="button-colored" onClick={close}>Cancel</button>
                    <button type="button" class="button-colored encounter-add-picked" disabled={!picked.length}
                        onClick={() => addSheets(picked)}>Add</button>
                </div>
            </div>
        </div>
    );
}
