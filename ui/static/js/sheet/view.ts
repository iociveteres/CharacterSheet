// A view of a sheet on the page: the sheet rendered into a shadow root of its
// own with the sheet's styles, its autocomplete, and its name announced to
// the room. The room's container shows one (main.ts); GM mode opens one over
// the encounter window. A view does not own its sheet: its holders do.
import { Autocomplete } from "./autocomplete";
import { sendToRoom } from "./network";
import { mountSheet } from "./Sheet";
import type { SheetInstance } from "./instance";
import { announceCharacterName } from "./characterName";

let stylesheet: Promise<CSSStyleSheet> | null = null;
let loaded: CSSStyleSheet | null = null;

// view_room.html names the styles on the sheet's container.
const stylesheetHref = () => document.getElementById("character-sheet-container")?.dataset.sheetCss ?? "";

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

/**
 * Renders `sheet` into a new host element `hostId` that replaces the children
 * of `box`; returns what takes the view away.
 */
export function renderSheetView(sheet: SheetInstance, box: HTMLElement, css: CSSStyleSheet, hostId = "charactersheet"): () => void {
    const host = document.createElement("div");
    host.id = hostId;
    host.dataset.sheetId = sheet.sheetId;
    host.dataset.sheetKind = sheet.kindName;
    const root = host.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [css];
    box.replaceChildren(host);

    const autocomplete = new Autocomplete({ send: sendToRoom });
    const unmount = mountSheet(sheet, root, autocomplete);
    const unannounce = announceCharacterName(sheet);
    return () => {
        unannounce();
        unmount();
        autocomplete.destroy();
    };
}
