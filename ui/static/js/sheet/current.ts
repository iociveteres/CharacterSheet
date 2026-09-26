// The sheet the page shows. network.js stamps outgoing messages with its id
// and applies only the remote changes of this sheet.
import type {
    CharacterSheetContent, MeleeAttackRoll, PsychicPowerRoll, RangedAttackRoll, TechPowerRoll,
} from "./schema/content.gen";

/** Roll settings a new attack or power starts with. */
export interface RollDefaults {
    rangedAttack: RangedAttackRoll;
    meleeAttack: MeleeAttackRoll;
    psychicPower: PsychicPowerRoll;
    techPower: TechPowerRoll;
}

/** What the server sends for a sheet (SheetPayload in internal/templates/sheet_funcs.go). */
export interface SheetPayload {
    sheetId: string;
    kind: string;
    /** Whether the viewer may edit the sheet. */
    canEdit: boolean;
    content: CharacterSheetContent;
    rollDefaults: RollDefaults;
}

let current: string | null = null;

/** The id of the open sheet, null when none is open. */
export const currentSheetId = (): string | null => current;

export function setCurrentSheetId(id: string | null): void {
    current = id;
}
