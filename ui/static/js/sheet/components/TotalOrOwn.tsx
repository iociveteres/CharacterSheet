import type { Ref, VNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { useSheet } from "./context";

/**
 * `total` until focused, then the own field that `own` renders, focused, to
 * edit; the own field alone while nothing changes it (`total` null).
 */
export function TotalOrOwn({ total, title, totalId, class: cls, own }: {
    total: number | string | null;
    title: string;
    totalId: string;
    class: string;
    own: (props: { inputRef: Ref<HTMLInputElement>; onBlur: () => void }) => VNode;
}) {
    const { canEdit } = useSheet();
    const [editing, setEditing] = useState(false);
    const ownRef = useRef<HTMLInputElement>(null);
    useLayoutEffect(() => {
        if (editing) ownRef.current?.focus();
    }, [editing]);

    if (total === null || editing) return own({ inputRef: ownRef, onBlur: () => setEditing(false) });
    return (
        <input type="text" data-id={totalId} class={cls} readOnly value={total} title={title}
            onFocus={() => canEdit && setEditing(true)} />
    );
}
