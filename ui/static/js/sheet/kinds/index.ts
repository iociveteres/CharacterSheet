// The sheet kinds. kinds.gen.ts lists the kinds the server knows
// (internal/models/sheet_kinds.go), and the type of KINDS makes tsc fail for
// a kind without a definition.
import { blackCrusade } from "./black_crusade";
import type { SheetKindDef } from "./kind";
import type { SheetKind } from "./kinds.gen";
import { pathfinderCrusade } from "./pathfinder_crusade";

export const KINDS: { readonly [K in SheetKind]: SheetKindDef } = {
    black_crusade: blackCrusade,
    pathfinder_crusade: pathfinderCrusade,
};

/** The definition of `kind`, null for a kind this bundle does not know. */
export function kindOf(kind: string): SheetKindDef | null {
    return Object.hasOwn(KINDS, kind) ? KINDS[kind as SheetKind] : null;
}
