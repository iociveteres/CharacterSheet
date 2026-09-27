import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { Transition } from "./Transition";

let root: HTMLElement;
const show = (visible: boolean) => act(() => render(
    <Transition show={visible} name="popover"><div class="box" /></Transition>, root));
const box = () => root.querySelector(".box");

beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement("div");
    document.body.append(root);
});

afterEach(() => {
    render(null, root);
    root.remove();
    vi.useRealTimers();
});

describe("a transition", () => {
    it("shows or hides at once on the first render", () => {
        show(false);
        expect(box()).toBeNull();

        render(null, root);
        show(true);
        expect(box()!.className).toBe("box");
    });

    it("enters with the enter classes until the transition ends", () => {
        show(false);
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ transitionDuration: "0.15s, 0.15s", transitionDelay: "0s" } as CSSStyleDeclaration);

        show(true);
        expect(box()!.className).toBe("box popover-enter popover-enter-end");
        act(() => {
            vi.advanceTimersByTime(149);
        });
        expect(box()!.className).toBe("box popover-enter popover-enter-end");
        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(box()!.className).toBe("box");
        vi.restoreAllMocks();
    });

    it("keeps the element while it leaves", () => {
        show(true);
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ transitionDuration: "0.2s", transitionDelay: "0.05s" } as CSSStyleDeclaration);

        show(false);
        expect(box()!.className).toBe("box popover-leave popover-leave-end");
        act(() => {
            vi.advanceTimersByTime(249);
        });
        expect(box()).not.toBeNull();
        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(box()).toBeNull();
        vi.restoreAllMocks();
    });

    it("turns back when shown again while it leaves", () => {
        show(true);
        vi.spyOn(window, "getComputedStyle").mockReturnValue({ transitionDuration: "0.2s", transitionDelay: "0s" } as CSSStyleDeclaration);

        show(false);
        act(() => {
            vi.advanceTimersByTime(100);
        });
        show(true);
        act(() => {
            vi.advanceTimersByTime(200);
        });

        expect(box()!.className).toBe("box");
        vi.restoreAllMocks();
    });
});
