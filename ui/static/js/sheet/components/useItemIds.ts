import { Signal } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import { getItemVersion, resolvePath } from "../state/sync.js";

export type Positions = { readonly [id: string]: Position };

/**
 * The items of the grid at `gridPath` ("conditions.list.items") and their
 * positions. items is a plain object, so the component follows the grid's
 * item version, which every create, delete and move bumps (together with the
 * coarse keys computed.js reads, see PARENT_VERSION_KEYS in sync.js), and
 * the grid's layouts signal.
 */
export function useItemIds(gridPath: string): { ids: string[]; layouts: Positions } {
    getItemVersion(gridPath).value;
    const layoutsNode = resolvePath(gridPath.replace(/items$/, "layouts"));
    const layouts = layoutsNode instanceof Signal ? (layoutsNode.value as Positions) : {};
    const items = resolvePath(gridPath);
    const ids = items && typeof items === "object" && !(items instanceof Signal) ? Object.keys(items) : [];
    return { ids, layouts };
}
