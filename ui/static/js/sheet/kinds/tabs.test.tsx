import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, teardownSheet, type Rendered } from "../components/testUtils";
import { NavTab } from "./tabs";

let rendered: Rendered | null = null;
let resized: (() => void) | null = null;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    vi.stubGlobal("ResizeObserver", class {
        constructor(callback: () => void) { resized = callback; }
        observe() {}
        disconnect() {}
    });
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resized = null;
    teardownSheet();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = "";
});

const panel = () => rendered!.container.querySelector<HTMLElement>(".panel")!;
const drawn = () => panel().classList.contains("drawn");

/** The panel gets `width`, as a window drag gives it, and the observer is told. */
function resize(width: number) {
    Object.defineProperty(panel(), "clientWidth", { configurable: true, get: () => width });
    act(() => resized!());
}

function wait(ms: number) {
    act(() => { vi.advanceTimersByTime(ms); });
}

describe("NavTab", () => {
    it("keeps its cards skipped while the width changes, and draws them again once it has been still for 150 ms", () => {
        loadState({});
        rendered = renderBlock(<NavTab id="show-x" label="X" panelId="x" panelClass="x" first><div /></NavTab>);
        wait(50);
        expect(drawn(), "drawn after its first frames").toBe(true);

        resize(900);
        wait(100);
        resize(880);
        wait(100);
        expect(drawn(), "still skipping while the width changes").toBe(true);

        wait(50);
        expect(drawn(), "drawn again at the new width").toBe(false);
        wait(50);
        expect(drawn(), "skipping again once drawn").toBe(true);
    });

    it("marks the cards within 1.6 screens near while scrolling, and only those on screen once it stops", () => {
        loadState({});
        // Cards 500 px tall one under the other in a box 1000 px tall, scrolled to the third screen.
        const tops = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500];
        rendered = renderBlock(
            <div class="box" style="overflow-y: auto">
                <NavTab id="show-x" label="X" panelId="x" panelClass="x" first>
                    <div class="item-grid"><div class="layout-column">
                        {tops.map(top => <div key={top} class="item-with-description" data-top={top} />)}
                    </div></div>
                </NavTab>
            </div>,
        );
        const box = rendered.container.querySelector<HTMLElement>(".box")!;
        const scrollTop = 3200;
        box.getBoundingClientRect = () => ({ top: 0, bottom: 1000 }) as DOMRect;
        const cards = Array.from(rendered.container.querySelectorAll<HTMLElement>(".item-with-description"));
        for (const card of cards) {
            const top = Number(card.dataset.top) - scrollTop;
            card.getBoundingClientRect = () => ({ top, bottom: top + 500 }) as DOMRect;
        }
        const near = () => cards.filter(c => c.hasAttribute("data-near")).map(c => Number(c.dataset.top));
        wait(50);
        expect(near(), "no marks before a scroll").toEqual([]);

        act(() => { box.dispatchEvent(new Event("scroll")); });
        // On screen 3200–4200; 1.6 screens on each side: from 1600 to 5800.
        expect(near()).toEqual([1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500]);
        wait(300);
        // Half a screen on each side: from 2700 to 4700.
        expect(near()).toEqual([2500, 3000, 3500, 4000, 4500]);
    });
});
