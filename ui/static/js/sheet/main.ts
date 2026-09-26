// Entry point of the sheet bundle. It puts sheets into the room page: the one
// the page was opened on (#sheet-state) and the ones picked in the room list,
// fetched as JSON from /sheet/view/:id.
import { Autocomplete } from "./autocomplete";
import { sendToRoom, sheetActions } from "./network";
import { initState } from "./state/state";
import { kindOf } from "./kinds/index";
import { onSheetTeardown, teardownSheet } from "./lifecycle";
import { mountSheet } from "./Sheet";
import { currentSheetId, setCurrentSheetId, type SheetPayload } from "./current";
import { announceCharacterName } from "./characterName";

const CONTAINER_ID = "character-sheet-container";
const SHEET_LINK = 'a[href^="/sheet/view/"]';

function container(): HTMLElement | null {
    return document.getElementById(CONTAINER_ID);
}

let stylesheet: Promise<CSSStyleSheet> | null = null;

// One constructed stylesheet serves every sheet the page shows. A failed load
// is not kept, so the next sheet tries again.
function sheetStylesheet(href: string): Promise<CSSStyleSheet> {
    stylesheet ??= fetch(href)
        .then(res => {
            if (!res.ok) throw new Error(`Sheet styles: ${res.status}`);
            return res.text();
        })
        .then(css => new CSSStyleSheet().replace(css))
        .catch(err => {
            stylesheet = null;
            throw err;
        });
    return stylesheet;
}

/** Removes the open sheet and releases what it set up. */
function closeSheet(): void {
    if (!currentSheetId()) return;
    teardownSheet();
    setCurrentSheetId(null);
    container()?.replaceChildren();
}

interface OpenOptions {
    /** The open sheet again, from the server: collapsed items, tabs and scroll stay. */
    reload?: boolean;
}

/** Replaces the open sheet with the sheet of `payload`. */
async function openSheet(payload: SheetPayload, { reload = false }: OpenOptions = {}): Promise<void> {
    const box = container();
    if (!box) return;
    const kind = kindOf(payload.kind);
    if (!kind) throw new Error(`Unknown sheet kind "${payload.kind}"`);
    const css = await sheetStylesheet(box.dataset.sheetCss!);

    const { scrollTop, scrollLeft } = box;
    closeSheet();
    const host = document.createElement("div");
    host.id = "charactersheet";
    host.dataset.sheetId = payload.sheetId;
    host.dataset.sheetKind = payload.kind;
    const root = host.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [css];
    box.replaceChildren(host);

    setCurrentSheetId(payload.sheetId);
    initState(kind, payload.content, { keepUi: reload });
    announceCharacterName(payload.sheetId);
    const autocomplete = new Autocomplete({ send: sendToRoom });
    onSheetTeardown(() => autocomplete.destroy());
    mountSheet(root, {
        sheetId: payload.sheetId,
        canEdit: payload.canEdit,
        rollDefaults: payload.rollDefaults,
        actions: sheetActions,
        autocomplete,
    }, kind.Layout);
    if (reload) Object.assign(box, { scrollTop, scrollLeft });

    // For the e2e probes and the render measurement (scripts/perf).
    box.dispatchEvent(new CustomEvent("charactersheet_inserted", { bubbles: true }));
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

async function loadSheet(url: string, options: OpenOptions = {}): Promise<void> {
    const box = container();
    if (!box) return;
    const current = ++request;
    box.classList.add("loading");
    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`Network error: ${res.status}`);
        const payload = await res.json() as SheetPayload;
        if (current === request) await openSheet(payload, options);
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
    void loadSheet(link.href);
});

/** A short notice at the top of the room page (room/toasts.js). */
function notify(message: string): void {
    document.dispatchEvent(new CustomEvent("sheet:notice", { detail: { message } }));
}

let reloading: Promise<void> | null = null;

/** Reads the open sheet from the server again; one reload at a time. */
function reloadSheet(): void {
    const id = currentSheetId();
    if (!id || reloading) return;
    reloading = loadSheet(`/sheet/view/${id}`, { reload: true }).finally(() => { reloading = null; });
}

const EDIT_FAILED: { [reason: string]: string } = {
    permission: "you can no longer edit this sheet",
    tooLarge: "it is larger than 32 KB",
    offline: "there is no connection to the server",
};

// The server does not have an edit the sheet shows (network.ts): the sheet
// is read again, so it shows what the server has.
document.addEventListener("sheet:editFailed", e => {
    const { sheetID, reason } = (e as CustomEvent<{ sheetID: string; reason: string }>).detail;
    notify(`Your change was not saved: ${EDIT_FAILED[reason] ?? "the server rejected it"}.`);
    if (sheetID === currentSheetId()) reloadSheet();
});

document.addEventListener("ws:disconnected", () => {
    if (currentSheetId()) notify("Connection lost: the sheet is read-only until it is back.");
});

document.addEventListener("ws:reconnected", () => {
    if (!currentSheetId()) return;
    notify("Connection restored.");
    reloadSheet();
});

// The room list drops a deleted sheet; the sheet goes with it.
document.addEventListener("ws:deleteCharacter", e => {
    const { sheetID } = (e as CustomEvent<{ sheetID: string | number }>).detail;
    if (currentSheetId() === String(sheetID)) closeSheet();
});

// A room page opened on a sheet carries it in #sheet-state.
const embedded = document.getElementById("sheet-state");
if (embedded) {
    openSheet(JSON.parse(embedded.textContent ?? "") as SheetPayload).catch(err => {
        console.error(err);
        showError(err instanceof Error ? err.message : String(err));
    });
}
