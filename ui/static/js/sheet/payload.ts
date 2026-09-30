// What the server sends for a sheet: its content and what the viewer may do with it.
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
