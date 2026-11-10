import { Signal } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import type { SheetSignals } from "../schema/sheet";
import { columnsFromLayout } from "../components/columns";
import { gridSpecOf } from "./fromJson";
import { schemaOf } from "./state";
import { resolvePath } from "./sync";

/** The item ids of the grid at `gridPath` in the order it shows them, column by column. */
export function idsInOrder(state: SheetSignals, gridPath: string): string[] {
    const items = resolvePath(state, gridPath);
    if (!items || items instanceof Signal || typeof items !== "object") return [];
    const layouts = resolvePath(state, gridPath.replace(/items$/, "layouts"));
    const positions = (layouts instanceof Signal ? layouts.value : {}) as { [id: string]: Position };
    return columnsFromLayout(gridSpecOf(schemaOf(state), gridPath)?.columns ?? 1, positions, Object.keys(items)).flat();
}
