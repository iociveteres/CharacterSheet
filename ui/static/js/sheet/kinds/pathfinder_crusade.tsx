// Pathfinder Crusade has the schema, computeds and layout of Black Crusade for
// now. Give it its own once the two kinds start to differ: sheets of the kind
// are then read with its schema.
import { blackCrusade } from "./black_crusade";
import type { SheetKindDef } from "./kind";

export const pathfinderCrusade: SheetKindDef = { ...blackCrusade };
