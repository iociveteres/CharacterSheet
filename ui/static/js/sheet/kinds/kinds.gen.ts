// Source: internal/models/sheet_kinds.go.
// Regenerate with `npm run gen:types`.

export const SHEET_KINDS = ["black_crusade","pathfinder_crusade"] as const;

export type SheetKind = (typeof SHEET_KINDS)[number];

export const DEFAULT_SHEET_KIND: SheetKind = "black_crusade";
