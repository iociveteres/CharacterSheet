// What comes to the encounter from the server (ws:<type>, see room/socket.js).
// The handlers only change the state, through actions.ts.
import { showToast } from "../actions";
import { runOrQueue } from "../dragFreeze";
import { encounter } from "./state";
import {
    answered, applyEncounter, isCreated, openEncounter, refreshMonsters, reopenEncounter, setEncounterList, setShownView,
    takeEncountersChanged, takeInitiativeTotals, takeNotes,
} from "./actions";
import type {
    EncounterListMessage, EncounterNotesMessage, EncounterRolledMessage, EncountersChangedMessage, EncounterStateMessage,
    InitiativeViewMessage,
} from "./messages";

const on = <T>(type: string, handle: (msg: T) => void) =>
    document.addEventListener(`ws:${type}`, e => handle((e as CustomEvent<T>).detail));

// Away for less, the gamemaster has hardly edited a creature in the bestiary.
const AWAY_MS = 5000;

export function listenEncounter(): void {
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) hiddenAt = Date.now();
        else if (Date.now() - hiddenAt > AWAY_MS) void refreshMonsters();
    });
    on<EncounterStateMessage>("encounterState", ({ eventID, encounter: state }) => {
        answered(eventID);
        if (isCreated(eventID)) {
            void openEncounter(state.id);
            return;
        }
        // Another tab of the gamemaster may have another encounter open. A
        // drag of a card waits for its drop (components/useListSortable.ts).
        runOrQueue(() => {
            if (encounter.peek()?.id === state.id) applyEncounter(state);
        });
    });
    on<EncountersChangedMessage>("encountersChanged", ({ encounters }) => takeEncountersChanged(encounters));
    on<EncounterNotesMessage>("encounterNotes", ({ encounterId, notes }) => takeNotes(encounterId, notes));
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
        if (!answered(eventID) || OK) return;
        showToast(code === "quota" && message ? `Not enough room: ${message}` : "The encounter did not take that change.");
    });
    on("reconnected", reopenEncounter);
}
