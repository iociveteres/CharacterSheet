import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { signal } from "@preact/signals";
import { flush, loadState, recordingActions, renderBlock, type Rendered } from "../components/testUtils";
import { CharacterInfo } from "./CharacterInfo";
import { createSheetInstance, type SheetInstance } from "../instance";
import { mountSheet, mountStatBlock } from "../Sheet";
import type { SheetPayload } from "../payload";
import { applyRemoteToState } from "../state/remote";
import { encodePortrait } from "../portraitCrop";

// The canvas of happy-dom draws and encodes nothing.
vi.mock("../portraitCrop", async importOriginal => ({
    ...await importOriginal<typeof import("../portraitCrop")>(),
    encodePortrait: vi.fn(async () => new Blob(["cropped"], { type: "image/webp" })),
}));

// happy-dom has no ondragover and the like, and Preact then listens to "DragOver" instead of "dragover".
for (const name of ["ondragover", "ondragleave", "ondrop"]) {
    if (!(name in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, name, { value: null, writable: true, configurable: true });
}

let view: Rendered | null = null;

beforeEach(() => {
    let urls = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++urls}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(encodePortrait).mockClear();
});

afterEach(() => {
    view?.unmount();
    view = null;
    vi.restoreAllMocks();
});

interface InfoOptions {
    canEdit?: boolean;
    upload?: (image: Blob) => Promise<void>;
    remove?: () => Promise<void>;
}

/** CharacterInfo of a sheet with portrait `hash`, for an editor or a viewer. */
function renderInfo(hash: string | null, { canEdit = true, upload, remove }: InfoOptions = {}) {
    loadState({ characterInfo: { characterName: "Kharn" } });
    const portrait = signal<string | null>(hash);
    const actions = recordingActions();
    if (upload) actions.uploadPortrait = upload;
    if (remove) actions.deletePortrait = remove;
    view = renderBlock(<CharacterInfo />, { portrait, canEdit, actions });
    return { portrait, container: view.container };
}

const info = (container: HTMLElement) => container.querySelector("#character_info")!;
const frame = (container: HTMLElement) => container.querySelector<HTMLElement>(".portrait");
const picker = (container: HTMLElement) => container.querySelector<HTMLInputElement>('.portrait-cell > input[type="file"]');
const editor = (container: HTMLElement) => container.querySelector<HTMLElement>(".portrait-pop .crop-pop");
const click = (el: Element | null) => act(() => (el as HTMLElement).click());

/** Picks `file` in the portrait's file input, as the browser's dialog does. */
function pick(container: HTMLElement, file: File): void {
    const input = picker(container)!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

/** Lets the image of the portrait window load, as the browser would. */
function loadImage(container: HTMLElement, width = 640, height = 480): void {
    const img = editor(container)!.querySelector<HTMLImageElement>(".crop-stage img")!;
    Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
    act(() => {
        img.dispatchEvent(new Event("load"));
    });
}

async function save(container: HTMLElement): Promise<void> {
    await act(async () => {
        editor(container)!.querySelector<HTMLElement>(".crop-save")!.click();
        await flush();
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
        click(empty);
        expect(opened).toHaveBeenCalledTimes(1);
        expect(editor(container)).toBeNull();
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
        click(frame(container));
        expect(editor(container)).toBeNull();
    });

    it("opens the portrait window on a click for an editor, but not from the full size button", () => {
        const { container } = renderInfo("0123456789abcdef");
        expect(frame(container)!.classList.contains("editable")).toBe(true);
        expect(container.querySelector(".edit-strip")!.textContent).toBe("✎ Edit");

        click(container.querySelector(".portrait-full-open"));
        expect(editor(container)).toBeNull();
        click(document.querySelector(".portrait-full-close"));

        const opened = vi.spyOn(picker(container)!, "click").mockImplementation(() => {});
        click(frame(container));
        expect(opened).not.toHaveBeenCalled();
        expect(frame(container)!.classList.contains("active")).toBe(true);
        expect(editor(container)!.querySelector(".crop-stage img")!.getAttribute("src")).toBe("/portrait/0123456789abcdef");
        // The saved portrait can be deleted.
        expect(editor(container)!.querySelector(".crop-delete")).not.toBeNull();

        click(editor(container)!.querySelector(".crop-cancel"));
        expect(editor(container)).toBeNull();
        expect(frame(container)!.classList.contains("active")).toBe(false);
    });

    it("opens the window on a picked file, which goes nowhere until Save", () => {
        const upload = vi.fn(() => Promise.resolve());
        const { container } = renderInfo(null, { upload });
        pick(container, new File(["photo"], "kharn.png", { type: "image/png" }));
        expect(editor(container)!.querySelector(".crop-stage img")!.getAttribute("src")).toBe("blob:1");
        // A new portrait has nothing to delete.
        expect(editor(container)!.querySelector(".crop-delete")).toBeNull();
        expect(upload).not.toHaveBeenCalled();
    });

    it("says under the frame that a picked file is not an image, and opens nothing", () => {
        const { container } = renderInfo(null);
        pick(container, new File(["text"], "notes.txt", { type: "text/plain" }));
        expect(editor(container)).toBeNull();
        expect(container.querySelector(".portrait-error")!.textContent).toBe("Not an image: choose a PNG, JPEG or WebP file.");
    });

    it("opens the window on an image dropped on the frame", () => {
        const { container } = renderInfo("0123456789abcdef");
        const file = new File(["photo"], "kharn.jpg", { type: "image/jpeg" });
        const target = frame(container)!;
        const drag = (type: string) => {
            const e = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], files: [file] } });
            act(() => {
                target.dispatchEvent(e);
            });
            return e;
        };
        expect(drag("dragover").defaultPrevented).toBe(true);
        expect(target.classList.contains("drop")).toBe(true);
        drag("drop");
        expect(target.classList.contains("drop")).toBe(false);
        expect(editor(container)!.querySelector(".crop-stage img")!.getAttribute("src")).toBe("blob:1");
    });

    it("follows portraitChanged", () => {
        const { portrait, container } = renderInfo(null, { canEdit: false });
        const sheet = { state: loadState({}), ui: null!, freeze: null!, portrait };
        act(() => applyRemoteToState(sheet, { type: "portraitChanged", portrait: "fedcba9876543210" }));
        expect(container.querySelector<HTMLImageElement>(".portrait img")!.getAttribute("src")).toBe("/portrait/fedcba9876543210");
        act(() => applyRemoteToState(sheet, { type: "portraitChanged", portrait: null }));
        expect(container.querySelector(".portrait-cell")).toBeNull();
    });
});

describe("saving a portrait", () => {
    let answer: { resolve: () => void; reject: (err: Error) => void };
    let sent: Blob[];
    const upload = (image: Blob) => {
        sent.push(image);
        return new Promise<void>((resolve, reject) => answer = { resolve, reject });
    };

    beforeEach(() => {
        sent = [];
    });

    const src = (container: HTMLElement) => container.querySelector<HTMLImageElement>(".portrait img")?.getAttribute("src");

    /** Picks `file`, lets it load in the window and saves it; blob:1 is the file, blob:2 what the window made of it. */
    async function saveFile(container: HTMLElement, file: File): Promise<void> {
        pick(container, file);
        loadImage(container);
        await save(container);
    }

    it("sends the cropped image, dimmed with a spinner, then shows the one portraitChanged brings", async () => {
        const { portrait, container } = renderInfo("0000000000000001", { upload });
        await saveFile(container, new File(["png"], "kharn.png", { type: "image/png" }));

        expect(editor(container)).toBeNull();
        expect(encodePortrait).toHaveBeenCalledTimes(1);
        expect(sent).toHaveLength(1);
        expect(await sent[0].text()).toBe("cropped");
        expect(src(container)).toBe("blob:2");
        expect(frame(container)!.classList.contains("uploading")).toBe(true);
        expect(container.querySelector(".spinner")).not.toBeNull();
        expect(container.querySelector(".edit-strip")).toBeNull();

        await act(async () => {
            answer.resolve();
            await flush();
        });
        // The hash has not come yet: the new image stays, no longer dimmed.
        expect(frame(container)!.classList.contains("uploading")).toBe(false);
        expect(src(container)).toBe("blob:2");

        act(() => {
            portrait.value = "0000000000000002";
        });
        expect(src(container)).toBe("/portrait/0000000000000002");
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:2");
    });

    it("keeps the old portrait and shows the error under it when the server refuses", async () => {
        const { container } = renderInfo("0000000000000001", { upload });
        await saveFile(container, new File(["png"], "kharn.png", { type: "image/png" }));

        await act(async () => {
            answer.reject(new Error("The image is larger than 128 KB."));
            await flush();
        });
        expect(src(container)).toBe("/portrait/0000000000000001");
        expect(frame(container)!.classList.contains("uploading")).toBe(false);
        expect(container.querySelector(".portrait-error")!.textContent).toBe("The image is larger than 128 KB.");
    });

    it("starts from an empty frame", async () => {
        const { container } = renderInfo(null, { upload });
        await saveFile(container, new File(["webp"], "kharn.webp", { type: "image/webp" }));
        expect(src(container)).toBe("blob:2");
        expect(container.querySelector(".portrait.empty")).toBeNull();
    });

    it("sends nothing when the saved portrait is saved untouched", async () => {
        const { container } = renderInfo("0000000000000001", { upload });
        click(frame(container));
        loadImage(container, 360, 480);
        await save(container);
        expect(editor(container)).toBeNull();
        expect(sent).toEqual([]);
        expect(encodePortrait).not.toHaveBeenCalled();
    });
});

describe("deleting a portrait", () => {
    const confirmDelete = (container: HTMLElement) => {
        click(frame(container));
        click(editor(container)!.querySelector(".crop-delete"));
        click(editor(container)!.querySelector(".crop-delete-yes"));
    };

    it("asks the server and leaves the portrait to portraitChanged", async () => {
        const remove = vi.fn(() => Promise.resolve());
        const { container } = renderInfo("0000000000000001", { remove });
        confirmDelete(container);
        await act(async () => {
            await flush();
        });
        expect(remove).toHaveBeenCalledTimes(1);
        expect(editor(container)).toBeNull();
        expect(container.querySelector(".portrait img")!.getAttribute("src")).toBe("/portrait/0000000000000001");
    });

    it("shows why the server refused under the portrait", async () => {
        const { container } = renderInfo("0000000000000001", { remove: () => Promise.reject(new Error("You cannot edit this sheet.")) });
        confirmDelete(container);
        await act(async () => {
            await flush();
        });
        expect(container.querySelector(".portrait-error")!.textContent).toBe("You cannot edit this sheet.");
    });
});

describe("the full size", () => {
    const open = () => {
        const { container } = renderInfo("0123456789abcdef", { canEdit: false });
        click(container.querySelector(".portrait-full-open"));
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
        click(fullView()!.querySelector(".portrait-full-close"));
        expect(fullView()).toBeNull();
    });

    it("closes by a click on the backdrop, not on the image", () => {
        open();
        click(fullView()!.querySelector("img"));
        expect(fullView()).not.toBeNull();
        click(fullView());
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
