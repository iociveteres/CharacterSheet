import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { AVATAR, AvatarRow } from "./Avatar";
import { encodeCrop } from "../crop/crop";

// The canvas of happy-dom draws and encodes nothing.
vi.mock("../crop/crop", async importOriginal => ({
    ...await importOriginal<typeof import("../crop/crop")>(),
    encodeCrop: vi.fn(async () => new Blob(["cropped"], { type: "image/webp" })),
}));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let container: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    let urls = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++urls}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(encodeCrop).mockClear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const answer = (status: number, body?: object) =>
    new Response(body ? JSON.stringify(body) : null, { status, headers: body ? { "Content-Type": "application/json" } : {} });

function renderRow(saved: string | null) {
    act(() => render(<AvatarRow saved={saved} csrf="token" />, container));
}

const frame = () => container.querySelector<HTMLElement>(".crop-box.avatar")!;
const editor = () => container.querySelector<HTMLElement>(".avatar-pop .crop-pop");
const shown = () => frame().querySelector("img")?.getAttribute("src") ?? null;
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());

/** Opens the window on the saved avatar, lets its image load and presses `button`. */
async function editAndPress(button: string): Promise<void> {
    click(frame());
    const img = editor()!.querySelector<HTMLImageElement>(".crop-stage img")!;
    Object.defineProperty(img, "naturalWidth", { value: 640, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 480, configurable: true });
    act(() => {
        img.dispatchEvent(new Event("load"));
    });
    // Zoomed in: Save of an untouched saved picture sends nothing.
    const zoom = editor()!.querySelector<HTMLInputElement>(".crop-zoom input")!;
    act(() => {
        zoom.value = "2";
        zoom.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
        editor()!.querySelector<HTMLElement>(button)!.click();
        await flush();
        await flush();
    });
}

describe("the avatar on the Account page", () => {
    it("crops to 192×192 in a square frame and keeps under the server's 64 KB", () => {
        expect(AVATAR.output).toEqual({ w: 192, h: 192 });
        expect(AVATAR.frame.w).toBe(AVATAR.frame.h);
        expect(AVATAR.maxBytes).toBe(64 * 1024);
    });

    it("puts the cropped image with the page's token and shows the address the server answers with", async () => {
        renderRow("/avatar/0123456789abcdef");
        fetchMock.mockResolvedValueOnce(answer(200, { url: "/avatar/fedcba9876543210" }));
        await editAndPress(".crop-save");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/account/avatar");
        expect(init.method).toBe("PUT");
        expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("token");
        expect(init.body).toBeInstanceOf(Blob);
        expect(shown()).toBe("/avatar/fedcba9876543210");
        expect(frame().classList.contains("uploading")).toBe(false);
        expect(container.querySelector(".avatar-error")).toBeNull();
    });

    it("keeps the old avatar and shows the refusal beside the frame, not under it", async () => {
        renderRow("/avatar/0123456789abcdef");
        fetchMock.mockResolvedValueOnce(answer(403));
        await editAndPress(".crop-save");

        expect(shown()).toBe("/avatar/0123456789abcdef");
        expect(container.querySelector(".avatar-side .avatar-error")).not.toBeNull();
        expect(container.querySelector(".crop-error")).toBeNull();
    });

    it("tells a refusal by its status and a lost connection apart", async () => {
        const messages: string[] = [];
        const results = [
            () => answer(400), () => answer(403), () => answer(413), () => answer(500),
            () => Promise.reject(new TypeError("Failed to fetch")),
        ];
        for (const result of results) {
            render(null, container);
            renderRow("/avatar/0123456789abcdef");
            fetchMock.mockImplementationOnce(async () => result());
            await editAndPress(".crop-save");
            messages.push(container.querySelector(".avatar-error")!.textContent!);
        }
        expect(new Set(messages).size).toBe(messages.length);
    });

    it("sends a JPEG without its metadata", async () => {
        const app1 = [0xFF, 0xE1, 0x00, 0x04, 0x45, 0x78];
        const rest = [0xFF, 0xDB, 0x00, 0x03, 0x01, 0xFF, 0xDA, 0x00, 0x02, 0x10, 0xFF, 0xD9];
        vi.mocked(encodeCrop).mockResolvedValueOnce(new Blob([new Uint8Array([0xFF, 0xD8, ...app1, ...rest])], { type: "image/jpeg" }));
        renderRow("/avatar/0123456789abcdef");
        fetchMock.mockResolvedValueOnce(answer(200, { url: "/avatar/fedcba9876543210" }));
        await editAndPress(".crop-save");

        const body = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as Blob;
        expect(body.type).toBe("image/jpeg");
        expect([...new Uint8Array(await body.arrayBuffer())]).toEqual([0xFF, 0xD8, ...rest]);
    });

    it("deletes after the question and shows the empty frame", async () => {
        renderRow("/avatar/0123456789abcdef");
        fetchMock.mockResolvedValueOnce(answer(204));
        await editAndPress(".crop-delete");
        await act(async () => {
            editor()!.querySelector<HTMLElement>(".crop-delete-yes")!.click();
            await flush();
            await flush();
        });

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/account/avatar");
        expect(init.method).toBe("DELETE");
        expect(frame().classList.contains("empty")).toBe(true);
        expect(editor()).toBeNull();
    });
});
