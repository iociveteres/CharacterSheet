// WebSocket messages of the encounter (internal/roomws/encounter.go). The Go
// structs of the messages are not exported; these types follow them by hand.
// What they carry is generated in types.gen.ts.
import type { EncounterList, EncounterState, InitiativeView } from "./types.gen";
import type { SheetPayload } from "../../sheet/payload";
import type { SheetKind } from "../../sheet/kinds/kinds.gen";

// — From the server ———————————————————————

/** An encounter after a change, to the gamemaster's tabs; eventID is empty when the server changed it on its own. */
export interface EncounterStateMessage {
    type: "encounterState";
    eventID: string;
    encounter: EncounterState;
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

/** GET /encounter/:id: the encounter and the sheets of all its participants. */
export interface EncounterPayload {
    encounter: EncounterState;
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
    | ({ type: "encounterAddSheets"; sheetIds: number[] } & OfEncounter)
    | ({ type: "encounterNewNpc"; kind: SheetKind } & OfEncounter)
    | ({ type: "encounterDuplicate"; participantId: number; count: number } & OfEncounter)
    /** Copies of a creature of the gamemaster's bestiary, each in a group of its own. */
    | ({ type: "encounterAddCreature"; creatureId: number; count: number } & OfEncounter)
    | ({ type: "encounterRemove"; participantIds: number[] } & OfEncounter)
    /** An empty name takes the display name away. */
    | ({ type: "encounterSetDisplayName"; participantId: number; name: string } & OfEncounter)
    | ({ type: "encounterGroup"; participantIds: number[]; name: string } & OfEncounter)
    | ({ type: "encounterUngroup"; groupId: number } & OfEncounter)
    /** The positions of the groups by id, and what the players see of them. */
    | ({ type: "encounterOrder"; positions: { [groupId: number]: number }; view: InitiativeView } & OfEncounter)
    | ({ type: "encounterNext" } & OfEncounter)
    | ({ type: "encounterResetInitiative" } & OfEncounter)
    /** A roll per group or NPC: the sheet it is for, its name for the players and its expression, "1d10+7". */
    | ({ type: "encounterRollInitiative"; rolls: { sheetId: number; name: string; expression: string }[] } & OfEncounter);
