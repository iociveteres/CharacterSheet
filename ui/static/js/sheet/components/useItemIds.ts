import { Signal } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import { resolvePath } from "../state/sync";
import { useSheet } from "./context";

export type Positions = { readonly [id: string]: Position };

/**
 * The items of the grid at `gridPath` ("conditions.list.items") and their
 * positions. Reading the keys of items and the layouts signal re-renders the
 * component on create, delete and move.
 */
export function useItemIds(gridPath: string): { ids: string[]; layouts: Positions } {
    const { state } = useSheet();
    const layoutsNode = resolvePath(state, gridPath.replace(/items$/, "layouts"));
    const layouts = layoutsNode instanceof Signal ? (layoutsNode.value as Positions) : {};
    const items = resolvePath(state, gridPath);
    const ids = items && typeof items === "object" && !(items instanceof Signal) ? Object.keys(items) : [];
    return { ids, layouts };
}
