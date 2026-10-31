import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { signal } from "@preact/signals";
import { flush, loadState, recordingActions, renderBlock, type Rendered } from "../components/testUtils";
import { CharacterInfo } from "./CharacterInfo";
import { createSheetInstance, type SheetInstance } from "../instance";
import { mountSheet, mountStatBlock } from "../Sheet";
import type { SheetPayload } from "../payload";
import { applyRemoteToState } from "../state/remote";

let view: Rendered | null = null;

afterEach(() => {
    view?.unmount();
    view = null;
    vi.restoreAllMocks();
});

/** CharacterInfo of a sheet with portrait `hash`, for an editor or a viewer. */
function renderInfo(hash: string | null, { canEdit = true, upload }: { canEdit?: boolean; upload?: (image: Blob) => Promise<void> } = {}) {
    loadState({ characterInfo: { characterName: "Kharn" } });
    const portrait = signal<string | null>(hash);
    const actions = recordingActions();
    if (upload) actions.uploadPortrait = upload;
    view = renderBlock(<CharacterInfo />, { portrait, canEdit, actions });
    return { portrait, container: view.container };
}

const info = (container: HTMLElement) => container.querySelector("#character_info")!;
const frame = (container: HTMLElement) => container.querySelector<HTMLElement>(".portrait");
const picker = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="file"]');

/** Picks `file` in the portrait's file input, as the browser's dialog does. */
function pick(container: HTMLElement, file: File): void {
    const input = picker(container)!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

describe("the portrait in Character Information", () => {
    it("is an empty frame that opens the file picker for an editor of a sheet without one", () => {
        const { container } = renderInfo(null);
        expect(info(container).classList.contains("with-portrait")).toBe(true);
        const empty = frame(container)!;
        expect(empty.classList.contains("empty")).toBe(true);
        expect(empty.textContent).toBe("+ Portrait");
        expect(container.querySelector(".portrait img")).toBeNull();

        const opened = vi.spyOn(picker(container)!, "click").mockImplementation(() => {});
        act(() => empty.click());
        expect(opened).toHaveBeenCalledTimes(1);
    });

    it("is not there for a viewer of a sheet without one", () => {
        const { container } = renderInfo(null, { canEdit: false });
        expect(info(container).classList.contains("with-portrait")).toBe(false);
        expect(container.querySelector(".portrait-cell")).toBeNull();
    });

    it("shows a viewer the image by its hash with only the full size button", () => {
        const { container } = renderInfo("0123456789abcdef", { canEdit: false });
        expect(info(container).classList.contains("with-portrait")).toBe(true);
        expect(container.querySelector<HTMLImageElement>(".portrait img")!.getAttribute("src")).toBe("/portrait/0123456789abcdef");
        expect(frame(container)!.classList.contains("editable")).toBe(false);
        expect(container.querySelector(".edit-strip")).toBeNull();
        expect(container.querySelector(".portrait-full-open")).not.toBeNull();
        expect(picker(container)).toBeNull();
        expect(frame(container)!.getAttribute("role")).toBeNull();
    });

    it("lets an editor edit it: the Edit strip, and a click opens the file picker until the portrait window comes", () => {
        const { container } = renderInfo("0123456789abcdef");
        expect(frame(container)!.classList.contains("editable")).toBe(true);
        expect(container.querySelector(".edit-strip")!.textContent).toBe("✎ Edit");

        const opened = vi.spyOn(picker(container)!, "click").mockImplementation(() => {});
        act(() => frame(container)!.click());
        expect(opened).toHaveBeenCalledTimes(1);
        // ⤢ opens the full size, not the editing.
        act(() => container.querySelector<HTMLElement>(".portrait-full-open")!.click());
        expect(opened).toHaveBeenCalledTimes(1);
        act(() => document.querySelector<HTMLElement>(".portrait-full-close")!.click());
    });

    it("follows portraitChanged", () => {
        const { portrait, container } = renderInfo(null, { canEdit: false });
        const sheet = { state: loadState({}), ui: null!, freeze: { runOrQueue: (_: string[], run: () => void) => run() } as never, portrait };
        act(() => applyRemoteToState(sheet, { type: "portraitChanged", portrait: "fedcba9876543210" }));
        expect(container.querySelector<HTMLImageElement>(".portrait img")!.getAttribute("src")).toBe("/portrait/fedcba9876543210");
        act(() => applyRemoteToState(sheet, { type: "portraitChanged", portrait: null }));
        expect(container.querySelector(".portrait-cell")).toBeNull();
    });
});

describe("uploading a portrait", () => {
    let answer: { resolve: () => void; reject: (err: Error) => void };
    let sent: Blob[];
    const upload = (image: Blob) => {
        sent.push(image);
        return new Promise<void>((resolve, reject) => answer = { resolve, reject });
    };

    beforeEach(() => {
        sent = [];
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:new");
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    });

    const src = (container: HTMLElement) => container.querySelector<HTMLImageElement>(".portrait img")?.getAttribute("src");

    it("shows the new image dimmed with a spinner, then the one portraitChanged brings", async () => {
        const { portrait, container } = renderInfo("0000000000000001", { upload });
        const file = new File(["webp"], "kharn.webp", { type: "image/webp" });
        pick(container, file);

        expect(sent).toEqual([file]);
        expect(src(container)).toBe("blob:new");
        expect(frame(container)!.classList.contains("uploading")).toBe(true);
        expect(container.querySelector(".spinner")).not.toBeNull();
        expect(container.querySelector(".edit-strip")).toBeNull();

        await act(async () => {
            answer.resolve();
            await flush();
        });
        // The hash has not come yet: the new image stays, no longer dimmed.
        expect(frame(container)!.classList.contains("uploading")).toBe(false);
        expect(src(container)).toBe("blob:new");

        act(() => {
            portrait.value = "0000000000000002";
        });
        expect(src(container)).toBe("/portrait/0000000000000002");
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:new");
    });

    it("keeps the old portrait and shows the error under it when the server refuses", async () => {
        const { container } = renderInfo("0000000000000001", { upload });
        pick(container, new File(["png"], "kharn.png", { type: "image/png" }));

        await act(async () => {
            answer.reject(new Error("Not a 360×480 WebP or JPEG image."));
            await flush();
        });
        expect(src(container)).toBe("/portrait/0000000000000001");
        expect(frame(container)!.classList.contains("uploading")).toBe(false);
        expect(container.querySelector(".portrait-error")!.textContent).toBe("Not a 360×480 WebP or JPEG image.");
    });

    it("starts from an empty frame", () => {
        const { container } = renderInfo(null, { upload });
        pick(container, new File(["webp"], "kharn.webp", { type: "image/webp" }));
        expect(src(container)).toBe("blob:new");
        expect(container.querySelector(".portrait.empty")).toBeNull();
    });
});

describe("the full size", () => {
    const open = () => {
        const { container } = renderInfo("0123456789abcdef", { canEdit: false });
        act(() => container.querySelector<HTMLElement>(".portrait-full-open")!.click());
        return container;
    };
    const fullView = () => document.querySelector<HTMLElement>(".portrait-full");

    it("shows the image over the page, outside the block", () => {
        const container = open();
        expect(fullView()).not.toBeNull();
        expect(container.contains(fullView())).toBe(false);
        expect(fullView()!.querySelector("img")!.getAttribute("src")).toBe("/portrait/0123456789abcdef");
    });

    it("closes by ×", () => {
        open();
        act(() => fullView()!.querySelector<HTMLElement>(".portrait-full-close")!.click());
        expect(fullView()).toBeNull();
    });

    it("closes by a click on the backdrop, not on the image", () => {
        open();
        act(() => fullView()!.querySelector("img")!.click());
        expect(fullView()).not.toBeNull();
        act(() => fullView()!.click());
        expect(fullView()).toBeNull();
    });

    it("closes by Esc, which does not reach the popup the sheet is in", () => {
        const popupEsc = vi.fn();
        window.addEventListener("keydown", popupEsc);
        open();
        act(() => {
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(fullView()).toBeNull();
        expect(popupEsc).not.toHaveBeenCalled();
        window.removeEventListener("keydown", popupEsc);
    });

    it("goes with the sheet", () => {
        open();
        view!.unmount();
        view = null;
        expect(fullView()).toBeNull();
    });
});

describe("the portrait in the views of a sheet", () => {
    let sheet: SheetInstance | null = null;
    let unmount: (() => void) | null = null;

    afterEach(() => {
        unmount?.();
        sheet?.dispose();
        unmount = null;
        sheet = null;
    });

    const payload = (kind: string): SheetPayload => ({
        sheetId: "41",
        kind,
        canEdit: true,
        content: { characterInfo: { characterName: "Kharn" } } as unknown as SheetPayload["content"],
        portrait: "0123456789abcdef",
        rollDefaults: {} as SheetPayload["rollDefaults"],
    });

    for (const kind of ["black_crusade", "pathfinder_crusade"]) {
        it(`is on the Player Sheet of the full ${kind} sheet`, () => {
            sheet = createSheetInstance(payload(kind));
            const root = document.createElement("div");
            act(() => {
                unmount = mountSheet(sheet!, root, null);
            });
            expect(root.querySelector<HTMLImageElement>("#player-sheet .portrait img")!.getAttribute("src")).toBe("/portrait/0123456789abcdef");
        });

        it(`is not in the ${kind} stat block`, () => {
            sheet = createSheetInstance(payload(kind));
            const root = document.createElement("div");
            act(() => {
                unmount = mountStatBlock(sheet!, root, null);
            });
            expect(root.childElementCount).toBeGreaterThan(0);
            expect(root.querySelector(".portrait, .portrait-cell")).toBeNull();
        });
    }
});
