// The room shows the name of the open character in its list of sheets
// (room/network.js) and signs rolls with it (room/dice.js). It learns the name
// from these events instead of reading the sheet.
import type { Signal } from "@preact/signals-core";
import { characterState } from "./state/state.js";
import { onSheetTeardown, sheetEffect } from "./lifecycle";

type CharacterInfo = { characterName?: Signal<string> };

/**
 * Sends sheet:nameChanged with the name now and on every change, local or
 * remote, and sheet:closed when the sheet is torn down.
 */
export function announceCharacterName(sheetId: string): void {
    sheetEffect(() => {
        const info = (characterState as { characterInfo?: CharacterInfo }).characterInfo;
        const name = info?.characterName?.value ?? "";
        document.dispatchEvent(new CustomEvent("sheet:nameChanged", { detail: { sheetID: sheetId, change: name } }));
    });
    onSheetTeardown(() => {
        document.dispatchEvent(new CustomEvent("sheet:closed", { detail: { sheetID: sheetId } }));
    });
}
