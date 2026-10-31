// Files for the portrait of a sheet (sheet/blocks/Portrait.tsx) and the
// ways a user hands them to it.
import { expect } from "vitest";
import type { Locator, Page } from "playwright-core";
import { eventually } from "./wait";

/** A file as Playwright's file chooser takes it. */
export interface FilePayload {
    name: string;
    mimeType: string;
    buffer: Buffer;
}

/** A PNG of `width`×`height` drawn by the page's canvas: a gradient with a disc, so any crop of it differs. */
export async function pngFile(page: Page, width: number, height: number, name = "portrait.png"): Promise<FilePayload> {
    const base64 = await page.evaluate(([w, h]) => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext("2d")!;
        const fill = g.createLinearGradient(0, 0, w, h);
        fill.addColorStop(0, "#7a1f1f");
        fill.addColorStop(1, "#1f3f7a");
        g.fillStyle = fill;
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#e8d27a";
        g.beginPath();
        g.arc(w / 2, h / 3, Math.min(w, h) / 5, 0, Math.PI * 2);
        g.fill();
        return canvas.toDataURL("image/png").split(",")[1];
    }, [width, height] as const);
    return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

export const textFile = (name = "notes.txt"): FilePayload => ({ name, mimeType: "text/plain", buffer: Buffer.from("not an image") });

/** Clicks `trigger`, which opens the file picker, and picks `file` in it. */
export async function pickFile(page: Page, trigger: Locator, file: FilePayload): Promise<void> {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]);
    await chooser.setFiles(file);
}

/**
 * Drops `file` on `target` as from a file manager. Playwright's mouse cannot
 * drag a file from outside the page, so the drag events are dispatched with
 * a DataTransfer holding it.
 */
export async function dropFile(target: Locator, file: FilePayload): Promise<void> {
    const data = await target.page().evaluateHandle(({ name, mimeType, base64 }) => {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], name, { type: mimeType }));
        return transfer;
    }, { name: file.name, mimeType: file.mimeType, base64: file.buffer.toString("base64") });
    for (const type of ["dragenter", "dragover", "drop"]) await target.dispatchEvent(type, { dataTransfer: data });
    await data.dispose();
}

/** Waits until `img` has loaded and returns its size as served. */
export async function servedSize(img: Locator): Promise<{ width: number; height: number }> {
    const { width, height } = await eventually(
        () => img.evaluate((el: HTMLImageElement) => ({ complete: el.complete, width: el.naturalWidth, height: el.naturalHeight })),
        s => expect(s.complete && s.width > 0, "the portrait has loaded").toBe(true),
    );
    return { width, height };
}

/** The hash in the src of a served portrait: /portrait/:hash. */
export async function hashOf(img: Locator): Promise<string> {
    const src = await img.getAttribute("src");
    const match = /^\/portrait\/([0-9a-f]{16})$/.exec(src ?? "");
    if (!match) throw new Error(`Not a served portrait: ${src}`);
    return match[1];
}
