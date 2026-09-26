// Entry point of the sheet bundle. It puts sheets into the room page: the one
// the page was opened on (#sheet-state) and the ones picked in the room list,
// fetched as JSON from /sheet/view/:id.
import { Autocomplete } from "./autocomplete.js";
import { sheetActions, socket } from "./network.js";
import { initState } from "./state/state.js";
import { layoutOf } from "./kinds/index";
import { onSheetTeardown, teardownSheet } from "./lifecycle";
import { mountSheet } from "./Sheet";
import { currentSheetId, setCurrentSheetId, type SheetPayload } from "./current";

const CONTAINER_ID = "character-sheet-container";
const SHEET_LINK = 'a[href^="/sheet/view/"]';

function container(): HTMLElement | null {
    return document.getElementById(CONTAINER_ID);
}

let stylesheet: Promise<CSSStyleSheet> | null = null;

// One constructed stylesheet serves every sheet the page shows.
function sheetStylesheet(href: string): Promise<CSSStyleSheet> {
    stylesheet ??= fetch(href)
        .then(res => res.text())
        .then(css => new CSSStyleSheet().replace(css));
    return stylesheet;
}

/** Removes the open sheet and releases what it set up. */
function closeSheet(): void {
    if (!currentSheetId()) return;
    teardownSheet();
    setCurrentSheetId(null);
    container()?.replaceChildren();
}

/** Replaces the open sheet with the sheet of `payload`. */
async function openSheet(payload: SheetPayload): Promise<void> {
    const box = container();
    if (!box) return;
    const Layout = layoutOf(payload.kind);
    if (!Layout) throw new Error(`No layout for sheet kind "${payload.kind}"`);
    const css = await sheetStylesheet(box.dataset.sheetCss ?? "/static/css/sheet.css");

    closeSheet();
    const host = document.createElement("div");
    host.id = "charactersheet";
    host.dataset.sheetId = payload.sheetId;
    host.dataset.sheetKind = payload.kind;
    const root = host.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [css];
    box.replaceChildren(host);

    setCurrentSheetId(payload.sheetId);
    initState(payload.content);
    // The socket is replaced on reconnect, so it is looked up on every send.
    const autocomplete = new Autocomplete({ socket: { send: msg => socket?.send(msg) }, root });
    onSheetTeardown(() => autocomplete.destroy());
    mountSheet(root, {
        sheetId: payload.sheetId,
        canEdit: payload.canEdit,
        rollDefaults: payload.rollDefaults,
        actions: sheetActions,
        autocomplete,
    }, Layout);

    // The room page and the e2e probes learn that a sheet is shown.
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

async function loadSheet(url: string): Promise<void> {
    const box = container();
    if (!box) return;
    const current = ++request;
    box.classList.add("loading");
    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`Network error: ${res.status}`);
        const payload = await res.json() as SheetPayload;
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
    void loadSheet(link.href);
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
