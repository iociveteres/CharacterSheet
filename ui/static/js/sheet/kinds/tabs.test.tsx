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
});
