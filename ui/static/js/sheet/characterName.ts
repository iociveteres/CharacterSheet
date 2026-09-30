// The room shows the name of the character in its list of sheets as it is
// typed (room/remote.ts). It learns the name of the sheet it shows from these
// events instead of reading the sheet.
import { untracked } from "@preact/signals-core";
import type { SheetInstance } from "./instance";

/**
 * Sends sheet:nameChanged with the name now and on every change, local or
 * remote, while the sheet lives or until the returned function stops it.
 */
export function announceCharacterName({ sheetId, state, scope }: Pick<SheetInstance, "sheetId" | "state" | "scope">): () => void {
    return scope.effect(() => {
        const name = state.characterInfo?.characterName?.value ?? "";
        // What the listeners read is theirs: the effect follows the name only.
        untracked(() => document.dispatchEvent(new CustomEvent("sheet:nameChanged", { detail: { sheetID: sheetId, change: name } })));
    });
}
