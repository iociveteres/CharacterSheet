// Entry point of the sheet bundle. It puts sheets into the room page: the one
// the page was opened on (#sheet-state) and the ones picked in the room list,
// fetched as JSON from /sheet/view/:id.
import { kindOf } from "./kinds/index";
import { holdSheet, releaseSheet, replaceSheet, sheets, type SheetInstance } from "./instance";
import type { SheetPayload } from "./payload";
import { fetchSheet } from "./reload";
import { editFailedNotice } from "./network";
import { loadedStylesheet, renderSheetView, sheetStylesheet } from "./view";

const CONTAINER_ID = "character-sheet-container";
const SHEET_LINK = 'a[href^="/sheet/view/"]';

function container(): HTMLElement | null {
    return document.getElementById(CONTAINER_ID);
}

// The sheet in the container, which it holds, and what takes its view away.
let shown: SheetInstance | null = null;
let unmountView: (() => void) | null = null;

/** Removes the open sheet and lets go of it. */
function closeSheet(): void {
    unmountView?.();
    unmountView = null;
    if (shown) releaseSheet(shown.sheetId);
    shown = null;
    container()?.replaceChildren();
}

/** Renders `sheet` into the container in place of what it shows. */
function showView(sheet: SheetInstance, css: CSSStyleSheet, { keepScroll }: { keepScroll: boolean }): void {
    const box = container();
    if (!box) return;
    unmountView?.();
    // The box keeps its scroll through replaceChildren: another sheet would
    // open where the previous one was scrolled to. Reset before the render:
    // after it, scrollTo lays out the whole new sheet synchronously.
    if (!keepScroll) box.scrollTo(0, 0);
    unmountView = renderSheetView(sheet, box, css);
    shown = sheet;

    // For the e2e probes and the render measurement (scripts/perf).
    box.dispatchEvent(new CustomEvent("charactersheet_inserted", { bubbles: true }));
}

interface OpenOptions {
    /** The open sheet again, from the server: collapsed items, tabs and scroll stay. */
    reload?: boolean;
}

/** Replaces the open sheet with the sheet of `payload`. */
async function openSheet(payload: SheetPayload, { reload = false }: OpenOptions = {}): Promise<void> {
    if (!container()) return;
    // Before the open sheet is closed: a sheet this bundle cannot show leaves it be.
    if (!kindOf(payload.kind)) throw new Error(`Unknown sheet kind "${payload.kind}"`);
    const css = await sheetStylesheet();

    // The view moves to the new instance on sheet:replaced.
    if (reload && shown?.sheetId === payload.sheetId) {
        replaceSheet(payload);
        return;
    }
    // Held before the previous one goes: it may be the same sheet.
    const sheet = holdSheet(payload);
    const previous = shown;
    unmountView?.();
    unmountView = null;
    if (previous) releaseSheet(previous.sheetId);
    showView(sheet, css, { keepScroll: false });
}

function showError(message: string): void {
    const box = container();
    if (!box) return;
    const error = document.createElement("div");
    error.className = "error";
    error.textContent = `Failed to load sheet: ${message}`;
    box.replaceChildren(error);
}

// A later click wins over a response that is still on its way.
let request = 0;

async function loadSheet(sheetId: string): Promise<void> {
    const box = container();
    if (!box) return;
    const current = ++request;
    box.classList.add("loading");
    try {
        const payload = await fetchSheet(sheetId);
        if (current === request) await openSheet(payload);
    } catch (err) {
        console.error(err);
        if (current !== request) return;
        closeSheet();
        showError(err instanceof Error ? err.message : String(err));
    } finally {
        if (current === request) box.classList.remove("loading");
    }
}

document.addEventListener("click", e => {
    const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>(SHEET_LINK);
    if (!link || !container()) return;
    e.preventDefault();
    void loadSheet(new URL(link.href).pathname.split("/").pop()!);
});

/** A short notice at the top of the room page (showToast in room/actions.ts). */
function notify(message: string): void {
    document.dispatchEvent(new CustomEvent("sheet:notice", { detail: { message } }));
}

// The server does not have an edit the sheet shows (network.ts): reload.ts
// reads the sheet again, so it shows what the server has.
document.addEventListener("sheet:editFailed", e => {
    notify(editFailedNotice((e as CustomEvent<{ sheetID: string; reason: string }>).detail.reason));
});

// The open sheet was read again (reload.ts): the view shows the new instance.
document.addEventListener("sheet:replaced", e => {
    const { sheetID } = (e as CustomEvent<{ sheetID: string }>).detail;
    const sheet = sheets.get(sheetID);
    const css = loadedStylesheet();
    if (shown?.sheetId !== sheetID || !sheet || !css) return;
    showView(sheet, css, { keepScroll: true });
});

document.addEventListener("sheet:reloadFailed", e => {
    const { sheetID, message } = (e as CustomEvent<{ sheetID: string; message: string }>).detail;
    if (shown?.sheetId !== sheetID) return;
    closeSheet();
    showError(message);
});

document.addEventListener("ws:disconnected", () => {
    if (shown) notify("Connection lost: the sheet is read-only until it is back.");
});

// reload.ts reads the sheets again.
document.addEventListener("ws:reconnected", () => {
    if (shown) notify("Connection restored.");
});

// The room list drops a deleted sheet; the sheet goes with it.
document.addEventListener("ws:deleteCharacter", e => {
    const { sheetID } = (e as CustomEvent<{ sheetID: string | number }>).detail;
    if (shown?.sheetId === String(sheetID)) closeSheet();
});

// Firefox restores the scroll of the sheet box on reload and session restore,
// after the sheet has rendered: a long sheet would open in its middle.
history.scrollRestoration = "manual";

// A room page opened on a sheet carries it in #sheet-state.
const embedded = document.getElementById("sheet-state");
if (embedded) {
    openSheet(JSON.parse(embedded.textContent ?? "") as SheetPayload).catch(err => {
        console.error(err);
        showError(err instanceof Error ? err.message : String(err));
    });
}
