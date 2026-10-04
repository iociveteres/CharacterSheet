// What comes to the /bestiary page from outside: the server's messages over
// its socket (bestiary/socket.ts) and the events of the sheets on it. The
// handlers go through actions.ts, which alone writes the state.
import { editFailedNotice } from "../sheet/network";
import type { SheetChangeMessage } from "../room/messages";
import { creatureNamed, creatureSheetFailed, creatureSheetReplaced, creaturesDeleted, showToast } from "./actions";

// The name of a creature is the name of the character in its sheet (creatureNamePath in internal/models/bestiary.go).
const NAME_PATH = "characterInfo.characterName";

export function listenRemote(): void {
    // The full sheet announces its name as it is typed (sheet/characterName.ts).
    document.addEventListener("sheet:nameChanged", e => {
        const { sheetID, change } = (e as CustomEvent<{ sheetID: string; change: string }>).detail;
        creatureNamed(Number(sheetID), change ?? "");
    });
    // network.ts applies it to the sheet; the list may show the creature without its sheet.
    document.addEventListener("ws:change", e => {
        const msg = (e as CustomEvent<SheetChangeMessage>).detail;
        if (msg.path === NAME_PATH) creatureNamed(Number(msg.sheetID), String(msg.change ?? ""));
    });
    document.addEventListener("ws:creaturesDeleted", e => {
        void creaturesDeleted((e as CustomEvent<{ ids: number[] }>).detail.ids);
    });
    document.addEventListener("sheet:replaced", e => {
        creatureSheetReplaced((e as CustomEvent<{ sheetID: string }>).detail.sheetID);
    });
    document.addEventListener("sheet:notice", e => {
        showToast((e as CustomEvent<{ message: string }>).detail.message);
    });
    // reload.ts reads the sheet again.
    document.addEventListener("sheet:editFailed", e => {
        showToast(editFailedNotice((e as CustomEvent<{ reason: string }>).detail.reason));
    });
    document.addEventListener("sheet:reloadFailed", e => {
        const { sheetID, message } = (e as CustomEvent<{ sheetID: string; message: string }>).detail;
        void creatureSheetFailed(sheetID, message);
    });
    // socket.ts gives up after three reconnects.
    window.addEventListener("ws:connectionLost", () => {
        showToast("Connection lost. Reload the page.");
    });
}
