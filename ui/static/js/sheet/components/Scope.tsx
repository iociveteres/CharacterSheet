import type { ComponentChildren, JSX, Ref } from "preact";
import { PathContext, joinPath, usePath } from "./context";

type Attrs = Omit<JSX.HTMLAttributes<HTMLElement>, "ref"> & { for?: string; htmlFor?: string };

export interface ScopeProps extends Attrs {
    /** The data-id of the element; its segments extend the state path of the children. */
    dataId: string;
    as?: "div" | "label" | "span" | "fieldset" | "table" | "tr";
    elRef?: Ref<HTMLElement>;
    children?: ComponentChildren;
}

/**
 * An element with a data-id, e.g. an item or a grid, whose segments extend
 * the state path of its children. Nothing reads the path back from the DOM;
 * the data-ids stay as hooks for CSS and for tests that find fields by path.
 */
export function Scope({ dataId, as = "div", elRef, children, ...rest }: ScopeProps) {
    const path = joinPath(usePath(), dataId);
    // Typed as a div: the attributes used here are common to these tags.
    const Tag = as as "div";
    return (
        <Tag {...(rest as JSX.HTMLAttributes<HTMLDivElement>)} ref={elRef as Ref<HTMLDivElement>} data-id={dataId}>
            <PathContext.Provider value={path}>{children}</PathContext.Provider>
        </Tag>
    );
}
