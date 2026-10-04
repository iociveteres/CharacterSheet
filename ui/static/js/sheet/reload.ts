// The sheets on the page read again from the server when the page may no
// longer have what the server has: an edit the server did not take
// (sheet:editFailed from network.ts), or a connection that dropped. Every
// holder of a sheet then shows its new instance (sheet:replaced).
import { replaceSheet, sheets } from "./instance";
import type { SheetPayload } from "./payload";

/** The sheet as the server has it now, from /sheet/view/:id. */
export async function fetchSheet(sheetId: string): Promise<SheetPayload> {
    const res = await fetch(`/sheet/view/${sheetId}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Network error: ${res.status}`);
    return await res.json() as SheetPayload;
}

// One reload of a sheet at a time.
const reloading = new Map<string, Promise<void>>();

/**
 * Reads sheet `sheetId` again if it is on the page. A failed read leaves the
 * sheet as it is and says so in sheet:reloadFailed.
 */
export function reloadSheet(sheetId: string): Promise<void> {
    if (!sheets.has(sheetId)) return Promise.resolve();
    let reload = reloading.get(sheetId);
    if (reload) return reload;
    reload = fetchSheet(sheetId)
        .then(payload => {
            // It may have left the page while the request was on its way.
            if (sheets.has(sheetId)) replaceSheet(payload);
        })
        .catch(err => {
            console.error(err);
            const message = err instanceof Error ? err.message : String(err);
            document.dispatchEvent(new CustomEvent("sheet:reloadFailed", { detail: { sheetID: sheetId, message } }));
        })
        .finally(() => reloading.delete(sheetId));
    reloading.set(sheetId, reload);
    return reload;
}

document.addEventListener("sheet:editFailed", e => {
    void reloadSheet((e as CustomEvent<{ sheetID: string }>).detail.sheetID);
});

// What was said while the socket was closed never arrived.
document.addEventListener("ws:reconnected", () => {
    for (const sheetId of [...sheets.keys()]) void reloadSheet(sheetId);
});
