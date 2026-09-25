// The layout of each sheet kind. kinds.gen.ts lists the kinds the server
// knows (internal/models/sheet_kinds.go), and the type of LAYOUTS makes tsc
// fail for a kind without a layout.
import type { ComponentType } from "preact";
import { BlackCrusade } from "./black_crusade";
import type { SheetKind } from "./kinds.gen";
import { PathfinderCrusade } from "./pathfinder_crusade";

export const LAYOUTS: { readonly [K in SheetKind]: ComponentType } = {
    black_crusade: BlackCrusade,
    pathfinder_crusade: PathfinderCrusade,
};

/** The layout of `kind`, null for a kind this bundle does not know. */
export function layoutOf(kind: string): ComponentType | null {
    return Object.hasOwn(LAYOUTS, kind) ? LAYOUTS[kind as SheetKind] : null;
}
