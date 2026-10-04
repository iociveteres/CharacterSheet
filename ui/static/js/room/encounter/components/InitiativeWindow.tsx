// The floating window of the turn order, which everyone opens with the
// Initiative button: the round, the groups in order and whose turn it is, as
// the gamemaster shows them to the players. No wounds, no sheets.
import { useRef, useState } from "preact/hooks";
import { initiativeWindowOpen, shownView } from "../state";
import { toggleInitiativeWindow } from "../actions";

export function InitiativeWindow() {
    const [position, setPosition] = useState({ right: 24, top: 80 });
    const drag = useRef<{ x: number; y: number; right: number; top: number } | null>(null);
    if (!initiativeWindowOpen.value) return null;
    const view = shownView.value;

    const onPointerDown = (e: PointerEvent) => {
        if ((e.target as Element).closest("button")) return;
        drag.current = { x: e.clientX, y: e.clientY, ...position };
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
        const start = drag.current;
        if (!start) return;
        setPosition({
            right: Math.max(0, start.right - (e.clientX - start.x)),
            top: Math.max(0, start.top + (e.clientY - start.y)),
        });
    };
    const onPointerUp = () => {
        drag.current = null;
    };

    return (
        <div class="initiative-window" role="dialog" aria-label="Initiative" style={{ right: `${position.right}px`, top: `${position.top}px` }}>
            <div class="initiative-window-header" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                <span class="initiative-window-title">Initiative{view ? ` · round ${view.round}` : ""}</span>
                <button type="button" class="initiative-window-close" aria-label="Close" onClick={toggleInitiativeWindow}>×</button>
            </div>
            <div class="initiative-window-body">
                {view ? view.rows.map((row, i) => (
                    <div key={i} class={["encounter-order-row", i === view.current && "current", row.value === null && "encounter-muted"].filter(Boolean).join(" ")}>
                        <span class="encounter-order-name">{row.name}</span>
                        <span>{row.value ?? "—"}</span>
                    </div>
                )) : <p class="encounter-muted">No encounter is shown.</p>}
            </div>
        </div>
    );
}
