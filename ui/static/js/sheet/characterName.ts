// The room shows the name of the open character in its list of sheets
// (room/network.js) and signs rolls with it (room/remote.ts). It learns the name
// from these events instead of reading the sheet.
import { characterState } from "./state/state";
import { onSheetTeardown, sheetEffect } from "./lifecycle";

/**
 * Sends sheet:nameChanged with the name now and on every change, local or
 * remote, and sheet:closed when the sheet is torn down.
 */
export function announceCharacterName(sheetId: string): void {
    sheetEffect(() => {
        const name = characterState.characterInfo?.characterName?.value ?? "";
        document.dispatchEvent(new CustomEvent("sheet:nameChanged", { detail: { sheetID: sheetId, change: name } }));
    });
    onSheetTeardown(() => {
        document.dispatchEvent(new CustomEvent("sheet:closed", { detail: { sheetID: sheetId } }));
    });
}
