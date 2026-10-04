// A view of a sheet on the page: the sheet rendered into a shadow root of its
// own with the sheet's styles, its autocomplete, and its name announced to
// the room. The room's container shows one (main.ts); GM mode opens one over
// the encounter window and shows the stat block of a participant. A view does
// not own its sheet: its holders do.
import { Autocomplete } from "./autocomplete";
import { sendToRoom } from "./network";
import { mountSheet, mountStatBlock } from "./Sheet";
import type { SheetInstance } from "./instance";
import { announceCharacterName } from "./characterName";

let stylesheet: Promise<CSSStyleSheet> | null = null;
let loaded: CSSStyleSheet | null = null;

// The page names the styles on an element: the sheet's container in
// view_room.html, the bestiary's in bestiary.html.
const stylesheetHref = () => document.querySelector<HTMLElement>("[data-sheet-css]")?.dataset.sheetCss ?? "";

/**
 * The sheet's styles. One constructed stylesheet serves every view; a failed
 * load is not kept, so the next view tries again.
 */
export function sheetStylesheet(): Promise<CSSStyleSheet> {
    stylesheet ??= fetch(stylesheetHref())
        .then(res => {
            if (!res.ok) throw new Error(`Sheet styles: ${res.status}`);
            return res.text();
        })
        .then(css => new CSSStyleSheet().replace(css))
        .then(css => loaded = css)
        .catch(err => {
            stylesheet = null;
            throw err;
        });
    return stylesheet;
}

/** The styles once they are loaded, for a view rendered again at once. */
export const loadedStylesheet = (): CSSStyleSheet | null => loaded;

/** A new host element `hostId` of `sheet` in place of the children of `box`; its shadow root has the sheet's styles. */
function shadowHost(sheet: SheetInstance, box: HTMLElement, css: CSSStyleSheet, hostId: string): ShadowRoot {
    const host = document.createElement("div");
    host.id = hostId;
    host.dataset.sheetId = sheet.sheetId;
    host.dataset.sheetKind = sheet.kindName;
    const root = host.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [css];
    box.replaceChildren(host);
    return root;
}

/**
 * Renders `sheet` into a new host element `hostId` that replaces the children
 * of `box`; returns what takes the view away.
 */
export function renderSheetView(sheet: SheetInstance, box: HTMLElement, css: CSSStyleSheet, hostId = "charactersheet"): () => void {
    const root = shadowHost(sheet, box, css, hostId);
    const autocomplete = new Autocomplete({ send: sendToRoom });
    const unmount = mountSheet(sheet, root, autocomplete);
    const unannounce = announceCharacterName(sheet);
    return () => {
        unannounce();
        unmount();
        autocomplete.destroy();
    };
}

/**
 * Renders the stat block of `sheet` into a new host element that replaces
 * the children of `box`; returns what takes it away. Its autocomplete serves
 * "Add condition…"; it does not announce the name: it edits no names. A
 * preview is read only and has no rolls (SheetEnv.preview).
 */
export function renderStatBlockView(sheet: SheetInstance, box: HTMLElement, css: CSSStyleSheet, preview = false): () => void {
    const autocomplete = new Autocomplete({ send: sendToRoom });
    const unmount = mountStatBlock(sheet, shadowHost(sheet, box, css, "statblock-sheet"), autocomplete, preview);
    return () => {
        unmount();
        autocomplete.destroy();
    };
}
