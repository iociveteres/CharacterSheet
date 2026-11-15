import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { Scope } from "./Scope";
import { Tabs } from "./Tabs";
import { loadSheet, renderBlock, teardownSheet, type Rendered } from "./testUtils";

let rendered: Rendered | null = null;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    loadSheet({
        psykana: {
            tabs: {
                items: { t1: { name: "Biomancy" }, t2: { name: "Divination" } },
                layouts: { t1: { colIndex: 0, rowIndex: 0 }, t2: { colIndex: 0, rowIndex: 1 } },
            },
        },
    });
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    vi.useRealTimers();
    document.body.innerHTML = "";
});

function wait(ms: number) {
    act(() => { vi.advanceTimersByTime(ms); });
}

describe("Tabs", () => {
    // The cards of a closed tab have never been drawn: skipped off screen, they would get the
    // placeholder height (sheet.css .panel.drawn).
    it("says a panel is drawn only once its tab has been open for its first frames", () => {
        rendered = renderBlock(
            <Scope dataId="psykana">
                <Tabs dataId="tabs.items" group="psykana-tabs" renderLabel={() => null} renderPanel={id => <span>{id}</span>} />
            </Scope>,
        );
        const drawn = () => Array.from(rendered!.container.querySelectorAll(".panel"), p => p.classList.contains("drawn"));
        expect(drawn(), "not before its first frames").toEqual([false, false]);
        wait(50);
        expect(drawn(), "the open tab only").toEqual([true, false]);

        act(() => { rendered!.container.querySelector<HTMLInputElement>("#t2")!.click(); });
        expect(drawn(), "the tab just opened is not drawn yet").toEqual([true, false]);
        wait(50);
        expect(drawn()).toEqual([true, true]);
    });
});
