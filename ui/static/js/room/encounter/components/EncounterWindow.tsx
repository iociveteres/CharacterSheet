// The encounter window of GM mode, in place of the sheet (islands.tsx): the
// turn order, the characters, the NPCs; the sheet of a participant opens over
// it. Only the gamemaster has it.
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { addSheetsOpen, encounter, encounterList, popupSheetId, sheetOf } from "../state";
import { addSheets, closePopup, setAddSheetsOpen } from "../actions";
import { InitiativeColumn } from "./InitiativeColumn";
import { ParticipantColumn } from "./ParticipantColumn";
import { players, sheets } from "../../state";
import { sheetName } from "../../characters";
import { loadedStylesheet, renderSheetView, sheetStylesheet } from "../../../sheet/view";

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
                </>
            ) : (
                <div class="encounter-column encounter-none">
                    <p class="encounter-muted">No encounter is open. Create one in the menu of the first column.</p>
                </div>
            )}
            {addSheetsOpen.value && state && <AddSheets />}
            {popupSheetId.value && <SheetPopup sheetId={popupSheetId.value} />}
        </div>
    );
}

function closeOnOverlay(close: () => void) {
    return (e: JSX.TargetedMouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) close();
    };
}

function useEscape(close: () => void): void {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
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
                    <button type="button" onClick={close}>Cancel</button>
                    <button type="button" class="button-colored encounter-add-picked" disabled={!picked.length}
                        onClick={() => addSheets(picked)}>Add</button>
                </div>
            </div>
        </div>
    );
}

/** The full sheet of a participant over the encounter window. */
function SheetPopup({ sheetId }: { sheetId: string }) {
    const box = useRef<HTMLDivElement>(null);
    const sheet = sheetOf(Number(sheetId));
    useEscape(closePopup);

    // A sheet read again is a new instance: the view moves to it.
    useEffect(() => {
        const target = box.current;
        if (!sheet || !target) return;
        let unmount: (() => void) | null = null;
        let gone = false;
        const show = (css: CSSStyleSheet) => {
            if (!gone) unmount = renderSheetView(sheet, target, css, "popup-sheet");
        };
        const css = loadedStylesheet();
        if (css) show(css);
        else sheetStylesheet().then(show).catch(err => console.error(err));
        return () => {
            gone = true;
            unmount?.();
            target.replaceChildren();
        };
    }, [sheet]);

    return (
        <div class="overlay open" onClick={closeOnOverlay(closePopup)}>
            <div class="modal sheet-popup" role="dialog" aria-modal="true" aria-label="Sheet">
                <button type="button" class="close sheet-popup-close" aria-label="Close" onClick={closePopup}>×</button>
                <div class="sheet-popup-body" ref={box} />
            </div>
        </div>
    );
}
