import type { ComponentChildren, JSX, Ref } from "preact";
import { PathContext, joinPath, usePath } from "./context";

type DivAttrs = Omit<JSX.HTMLAttributes<HTMLDivElement>, "ref">;

export interface ScopeProps extends DivAttrs {
    /** The data-id of the element; its segments extend the state path of the children. */
    dataId: string;
    elRef?: Ref<HTMLDivElement>;
    children?: ComponentChildren;
}

/**
 * An element with a data-id, e.g. an item or a grid. network.js reads the
 * path of an edited field from the data-ids of its ancestors, so the DOM
 * nesting must match the state path the components use.
 */
export function Scope({ dataId, elRef, children, ...rest }: ScopeProps) {
    const path = joinPath(usePath(), dataId);
    return (
        <div {...rest} ref={elRef} data-id={dataId}>
            <PathContext.Provider value={path}>{children}</PathContext.Provider>
        </div>
    );
}
