// Maps a sheet kind to its init module, see internal/models/sheet_kinds.go.
import * as blackCrusade from "./black_crusade.js";
import * as pathfinderCrusade from "./pathfinder_crusade.js";

export const DEFAULT_SHEET_KIND = "black_crusade";

const kinds = {
    black_crusade: blackCrusade,
    pathfinder_crusade: pathfinderCrusade,
};

// Read on every call: the host element is replaced when another sheet is opened.
export function getSheetKind() {
    return document.getElementById("charactersheet")?.dataset.sheetKind ?? DEFAULT_SHEET_KIND;
}

export function getKindModule(kind) {
    return kinds[kind] ?? null;
}
