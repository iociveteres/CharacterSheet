// WebSocket messages of the encounter (internal/roomws/encounter.go). The Go
// structs of the messages are not exported; these types follow them by hand.
// What they carry is generated in types.gen.ts.
import type { EncounterList, EncounterState, EncounterVersion, InitiativeView } from "./types.gen";
import type { Side } from "./state";
import type { SheetPayload } from "../../sheet/payload";
import type { SheetKind } from "../../sheet/kinds/kinds.gen";

// — From the server ———————————————————————

/** An encounter after a change, to the gamemaster's tabs; eventID is empty when the server changed it on its own. */
export interface EncounterStateMessage {
    type: "encounterState";
    eventID: string;
    encounter: EncounterState;
}

/**
 * The encounters a change of the party reached whose state it did not send:
 * a tab that has one of them open, at an older version, reads it again.
 */
export interface EncountersChangedMessage {
    type: "encountersChanged";
    encounters: EncounterVersion[];
}

/** The notes of an encounter, to the gamemaster's tabs but the one that typed them. */
export interface EncounterNotesMessage {
    type: "encounterNotes";
    encounterId: number;
    notes: string;
}

export interface EncounterListMessage extends EncounterList {
    type: "encounterList";
    eventID: string;
}

/** To everyone in the room: the order of the shown encounter, null when none is shown. */
export interface InitiativeViewMessage {
    type: "initiativeView";
    view: InitiativeView | null;
}

/** Only to the tab that rolled for the NPCs: the totals to write into their sheets. */
export interface EncounterRolledMessage {
    type: "encounterRolled";
    eventID: string;
    totals: { sheetId: number; total: number }[];
}

/** GET /encounter/:id: the encounter, its notes and the sheets of its participants but those named in `have`. */
export interface EncounterPayload {
    encounter: EncounterState;
    notes: string;
    sheets: SheetPayload[];
}

// — To the server —————————————————————————

interface OfEncounter {
    encounterId: number;
}

export type EncounterRequest =
    | { type: "encounterCreate"; name: string }
    | ({ type: "encounterRename"; name: string } & OfEncounter)
    | ({ type: "encounterDelete" } & OfEncounter)
    /** encounterId null hides the shown one. */
    | { type: "encounterShow"; encounterId: number | null }
    /** Sheets of the room into its party: into every encounter of the room at once. The state comes of the one open, if any. */
    | { type: "partyAdd"; encounterId: number | null; sheetIds: number[] }
    | ({ type: "encounterDuplicate"; participantId: number; count: number } & OfEncounter)
    /** Copies of a creature of the gamemaster's bestiary, each in a group of its own. */
    | ({ type: "encounterAddCreature"; creatureId: number; count: number } & OfEncounter)
    | ({ type: "encounterRemove"; participantIds: number[] } & OfEncounter)
    /** An empty name takes the display name away. */
    | ({ type: "encounterSetDisplayName"; participantId: number; name: string } & OfEncounter)
    | ({ type: "encounterGroup"; participantIds: number[]; name: string } & OfEncounter)
    | ({ type: "encounterUngroup"; groupId: number } & OfEncounter)
    /** Into the other column; a participant of a group leaves it for a group of its own. */
    | ({ type: "encounterMove"; participantId: number; side: Side } & OfEncounter)
    /** The gamemaster's notes; the players never get them. */
    | ({ type: "encounterDescribe"; description: string } & OfEncounter)
    /** The positions of the groups by id, and what the players see of them. */
    | ({ type: "encounterOrder"; positions: { [groupId: number]: number }; view: InitiativeView } & OfEncounter)
    /** The players see no order of the shown encounter while the gamemaster has another one open. */
    | ({ type: "encounterDropView" } & OfEncounter)
    | ({ type: "encounterNext" } & OfEncounter)
    | ({ type: "encounterPrev" } & OfEncounter)
    | ({ type: "encounterResetInitiative" } & OfEncounter)
    /** A roll per group or NPC: the sheet it is for, its name for the players and its expression, "1d10+7". */
    | ({ type: "encounterRollInitiative"; rolls: { sheetId: number; name: string; expression: string }[] } & OfEncounter);
