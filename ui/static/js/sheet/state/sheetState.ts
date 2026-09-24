import type {
    CharacterSheetContent, MeleeAttackRoll, PsychicPowerRoll, RangedAttackRoll, TechPowerRoll,
} from "../schema/content.gen";

/** Roll settings a new attack or power starts with. */
export interface RollDefaults {
    rangedAttack: RangedAttackRoll;
    meleeAttack: MeleeAttackRoll;
    psychicPower: PsychicPowerRoll;
    techPower: TechPowerRoll;
}

/** The #sheet-state script the server renders next to the sheet. */
export interface SheetStatePayload {
    content: CharacterSheetContent;
    rollDefaults: RollDefaults;
    /** Whether the viewer may edit the sheet. */
    canEdit: boolean;
}

// Parsed once per script element: a new sheet brings a new element.
const parsed = new WeakMap<Element, SheetStatePayload>();

/** Reads the state of the sheet on the page. Throws when the page has none. */
export function readSheetState(): SheetStatePayload {
    const el = document.getElementById("sheet-state");
    if (!el) throw new Error("#sheet-state is missing from the sheet");

    let payload = parsed.get(el);
    if (!payload) {
        payload = JSON.parse(el.textContent ?? "") as SheetStatePayload;
        parsed.set(el, payload);
    }
    return payload;
}
