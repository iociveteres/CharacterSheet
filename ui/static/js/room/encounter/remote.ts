// What comes to the encounter from the server (ws:<type>, see room/socket.js).
// The handlers only change the state, through actions.ts.
import { showToast } from "../actions";
import { encounter } from "./state";
import {
    answered, applyEncounter, isCreated, openEncounter, reopenEncounter, setEncounterList, setShownView,
    takeInitiativeTotals,
} from "./actions";
import type { EncounterListMessage, EncounterRolledMessage, EncounterStateMessage, InitiativeViewMessage } from "./messages";

const on = <T>(type: string, handle: (msg: T) => void) =>
    document.addEventListener(`ws:${type}`, e => handle((e as CustomEvent<T>).detail));

export function listenEncounter(): void {
    on<EncounterStateMessage>("encounterState", ({ eventID, encounter: state }) => {
        answered(eventID);
        if (isCreated(eventID)) {
            void openEncounter(state.id);
            return;
        }
        // Another tab of the gamemaster may have another encounter open.
        if (encounter.peek()?.id === state.id) applyEncounter(state);
    });
    on<EncounterListMessage>("encounterList", ({ eventID, encounters, shownEncounterId }) => {
        answered(eventID);
        setEncounterList({ encounters, shownEncounterId });
    });
    on<InitiativeViewMessage>("initiativeView", ({ view }) => setShownView(view));
    on<EncounterRolledMessage>("encounterRolled", ({ eventID, totals }) => {
        answered(eventID);
        takeInitiativeTotals(eventID, totals);
    });
    on<{ eventID: string; OK: boolean; code?: string; message?: string }>("response", ({ eventID, OK, code, message }) => {
        if (OK || !answered(eventID)) return;
        showToast(code === "quota" && message ? `Not enough room: ${message}` : "The encounter did not take that change.");
    });
    on("reconnected", reopenEncounter);
}
