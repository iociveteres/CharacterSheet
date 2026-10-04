// The floating window of the turn order, which everyone opens with the
// Initiative button: the round, the groups in order and whose turn it is, as
// the gamemaster shows them to the players. No wounds, no sheets.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { initiativeWindowOpen, shownView } from "../state";
import { toggleInitiativeWindow } from "../actions";

type Point = { left: number; top: number };

const POSITION_KEY = "initiativeWindowPosition";
const GAP = 8;
// Before the first render has measured the window.
const FALLBACK_SIZE = { width: 220, height: 120 };

function readPosition(): Point | null {
    try {
        const stored = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
        if (typeof stored?.left === "number" && typeof stored?.top === "number") return stored;
    } catch {
        // storage can be unavailable or hold garbage
    }
    return null;
}

function savePosition(position: Point): void {
    try {
        localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch {
        // storage can be unavailable
    }
}

/** Keeps the whole window inside the browser window. */
function clamp(p: Point, width: number, height: number): Point {
    return {
        left: Math.min(Math.max(0, p.left), Math.max(0, window.innerWidth - width)),
        top: Math.min(Math.max(0, p.top), Math.max(0, window.innerHeight - height)),
    };
}

/** Beside the Initiative button, to its left, where the right panel is. */
function besideButton(width: number): Point {
    const button = document.querySelector(".initiative-btn")?.getBoundingClientRect();
    if (!button) return { left: window.innerWidth - width - 24, top: 80 };
    return { left: button.left - width - GAP, top: button.top };
}

export function InitiativeWindow() {
    // Null until the player drags the window: then it follows the button.
    const [saved, setSaved] = useState<Point | null>(readPosition);
    const [, setViewportSize] = useState(0);
    const [size, setSize] = useState(FALLBACK_SIZE);
    const root = useRef<HTMLDivElement>(null);
    const drag = useRef<{ x: number; y: number; origin: Point; moved: Point } | null>(null);

    useEffect(() => {
        const onResize = () => setViewportSize(window.innerWidth * 10000 + window.innerHeight);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    // The rows change the height: measured after each render so that a window at the bottom edge grows upwards.
    useLayoutEffect(() => {
        const el = root.current;
        if (el && (el.offsetWidth !== size.width || el.offsetHeight !== size.height)) {
            setSize({ width: el.offsetWidth, height: el.offsetHeight });
        }
    });

    if (!initiativeWindowOpen.value) return null;
    const view = shownView.value;

    const { width, height } = size;
    const position = clamp(saved ?? besideButton(width), width, height);

    const onPointerDown = (e: PointerEvent) => {
        if ((e.target as Element).closest("button")) return;
        drag.current = { x: e.clientX, y: e.clientY, origin: position, moved: position };
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
        const start = drag.current;
        if (!start) return;
        start.moved = clamp({ left: start.origin.left + e.clientX - start.x, top: start.origin.top + e.clientY - start.y }, width, height);
        setSaved(start.moved);
    };
    const onPointerUp = () => {
        if (drag.current) savePosition(drag.current.moved);
        drag.current = null;
    };

    return (
        <div ref={root} class="initiative-window" role="dialog" aria-label="Initiative" style={{ left: `${position.left}px`, top: `${position.top}px` }}>
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
