import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { flush } from "../components/testUtils";
import { PortraitEditor, type PortraitEditorProps } from "./PortraitEditor";
import { encodePortrait, FRAME } from "../portraitCrop";

// The canvas of happy-dom draws and encodes nothing.
vi.mock("../portraitCrop", async importOriginal => ({
    ...await importOriginal<typeof import("../portraitCrop")>(),
    encodePortrait: vi.fn(async () => new Blob(["cropped"], { type: "image/webp" })),
}));

let box: HTMLElement;
let anchor: HTMLElement;
let calls: { save: Blob[]; delete: number; close: number };

beforeEach(() => {
    let urls = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++urls}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(encodePortrait).mockClear();
    calls = { save: [], delete: 0, close: 0 };
    anchor = document.createElement("div");
    box = document.createElement("div");
    anchor.append(box);
    document.body.append(anchor);
});

afterEach(() => {
    act(() => render(null, box));
    anchor.remove();
    vi.restoreAllMocks();
});

function open(props: Partial<PortraitEditorProps> = {}): void {
    act(() => {
        render(
            <PortraitEditor file={null} saved="/portrait/0123456789abcdef" anchor={{ current: anchor }}
                onSave={image => calls.save.push(image)} onDelete={() => calls.delete++} onClose={() => calls.close++} {...props} />,
            box,
        );
    });
}

const $ = <E extends Element = HTMLElement>(selector: string) => box.querySelector<E>(selector);
const click = (selector: string) => act(() => $(selector)!.click());
const image = () => $<HTMLImageElement>(".crop-stage img")!;
const zoom = () => $<HTMLInputElement>('input[type="range"]')!;

function load(width = 640, height = 480): void {
    Object.defineProperty(image(), "naturalWidth", { value: width, configurable: true });
    Object.defineProperty(image(), "naturalHeight", { value: height, configurable: true });
    act(() => {
        image().dispatchEvent(new Event("load"));
    });
}

async function save(): Promise<void> {
    await act(async () => {
        $(".crop-save")!.click();
        await flush();
    });
}

function choose(file: File): void {
    const input = $<HTMLInputElement>('.crop-side input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

describe("the portrait window", () => {
    it("opens the saved portrait, and Save before it loads does nothing", () => {
        open();
        expect(image().getAttribute("src")).toBe("/portrait/0123456789abcdef");
        expect($<HTMLButtonElement>(".crop-save")!.disabled).toBe(true);
        expect(zoom().disabled).toBe(true);
    });

    it("sends the crop it was zoomed to", async () => {
        open();
        load();
        act(() => {
            zoom().value = "2";
            zoom().dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(Number(zoom().value)).toBe(2);
        await save();
        expect(encodePortrait).toHaveBeenCalledTimes(1);
        const [img, size, crop] = vi.mocked(encodePortrait).mock.calls[0];
        expect(img).toBe(image());
        expect(size).toEqual({ width: 640, height: 480 });
        expect(crop.zoom).toBe(2);
        expect(calls.save).toHaveLength(1);
        expect(calls.close).toBe(0);
    });

    it("zooms with the wheel and moves the image by dragging", () => {
        open();
        load();
        const stage = $(".crop-stage")!;
        const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
        // happy-dom's WheelEvent has no pointer position.
        Object.defineProperties(wheel, { clientX: { value: FRAME.x }, clientY: { value: FRAME.y } });
        act(() => {
            stage.dispatchEvent(wheel);
        });
        expect(wheel.defaultPrevented).toBe(true);
        expect(image().style.transform).not.toContain("NaN");
        expect(Number(zoom().value)).toBeCloseTo(1.08);

        const before = image().style.transform;
        act(() => {
            stage.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
            stage.dispatchEvent(new PointerEvent("pointermove", { clientX: 90, clientY: 100, bubbles: true }));
            stage.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        });
        expect(image().style.transform).not.toBe(before);
    });

    it("sends an untouched new file, which has nothing to delete yet", async () => {
        open({ file: new File(["photo"], "kharn.png", { type: "image/png" }), saved: null });
        expect(image().getAttribute("src")).toBe("blob:1");
        expect($(".crop-delete")).toBeNull();
        load();
        await save();
        expect(calls.save).toHaveLength(1);
    });

    it("takes another file in place of the shown image", async () => {
        open();
        load();
        choose(new File(["text"], "notes.txt", { type: "text/plain" }));
        expect($(".crop-message")!.textContent).toBe("Not an image: choose a PNG, JPEG or WebP file.");
        expect(image().getAttribute("src")).toBe("/portrait/0123456789abcdef");

        choose(new File(["photo"], "kharn.png", { type: "image/png" }));
        expect($(".crop-message")).toBeNull();
        expect(image().getAttribute("src")).toBe("blob:1");
        load();
        await save();
        expect(calls.save).toHaveLength(1);
    });

    it("says so when the image does not open", () => {
        open({ file: new File(["junk"], "broken.png", { type: "image/png" }), saved: null });
        act(() => {
            image().dispatchEvent(new Event("error"));
        });
        expect($(".crop-message")!.textContent).toBe("Not an image: choose a PNG, JPEG or WebP file.");
        expect($<HTMLButtonElement>(".crop-save")!.disabled).toBe(true);
    });

    it("asks before it deletes", () => {
        open();
        click(".crop-delete");
        expect($(".crop-footer .question")!.textContent).toBe("Delete the portrait?");
        expect($(".crop-save")).toBeNull();
        click(".crop-keep");
        expect($(".crop-footer .question")).toBeNull();
        expect(calls.delete).toBe(0);

        click(".crop-delete");
        click(".crop-delete-yes");
        expect(calls.delete).toBe(1);
    });
});

describe("closing the portrait window", () => {
    it("happens on Cancel", () => {
        open();
        click(".crop-cancel");
        expect(calls.close).toBe(1);
    });

    it("happens on Esc, which does not reach the popup the sheet is in", () => {
        const popupEsc = vi.fn();
        window.addEventListener("keydown", popupEsc);
        open();
        act(() => {
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        window.removeEventListener("keydown", popupEsc);
        expect(calls.close).toBe(1);
        expect(popupEsc).not.toHaveBeenCalled();
    });

    it("happens on a press outside the window and the portrait, not inside them", () => {
        open();
        const press = (el: Element) => act(() => {
            el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
        });
        press($(".crop-stage")!);
        press(anchor);
        expect(calls.close).toBe(0);
        press(document.body);
        expect(calls.close).toBe(1);
    });
});
