import { Signal } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import { columnsFromLayout } from "../components/columns";
import { gridSpecOf } from "./fromJson";
import { resolvePath } from "./sync";

/** The item ids of the grid at `gridPath` in the order it shows them, column by column. */
export function idsInOrder(gridPath: string): string[] {
    const items = resolvePath(gridPath);
    if (!items || items instanceof Signal || typeof items !== "object") return [];
    const layouts = resolvePath(gridPath.replace(/items$/, "layouts"));
    const positions = (layouts instanceof Signal ? layouts.value : {}) as { [id: string]: Position };
    return columnsFromLayout(gridSpecOf(gridPath)?.columns ?? 1, positions, Object.keys(items)).flat();
}
