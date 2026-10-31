// The crop of the portrait window (blocks/PortraitEditor.tsx): the image lies
// on a 300×300 stage under a 3:4 frame, moved and zoomed so that it always
// covers the frame. What the frame shows is drawn at 360×480, the size the
// server takes (internal/webapp/portraits.go).

export const STAGE = 300;
export const FRAME = { x: 60, y: 30, w: 180, h: 240 } as const;
export const OUTPUT = { w: 360, h: 480 } as const;
export const MAX_ZOOM = 4;

export interface Size {
    width: number;
    height: number;
}

/** Where the image lies on the stage: its top left corner, and the zoom over the scale that just covers the frame. */
export interface Crop {
    x: number;
    y: number;
    zoom: number;
}

/** The part of the image the frame shows, in the image's own pixels, as drawImage takes it. */
export interface SourceRect {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
}

/** The scale at zoom 1: the image covers the frame and no more. */
const coverScale = (image: Size) => Math.max(FRAME.w / image.width, FRAME.h / image.height);

/** Stage pixels per image pixel. */
export const scaleOf = (image: Size, zoom: number) => coverScale(image) * zoom;

const between = (min: number, value: number, max: number) => Math.min(max, Math.max(min, value));

/** `crop` with its zoom in 1…MAX_ZOOM and moved so that the image covers the frame. */
export function clampCrop(image: Size, crop: Crop): Crop {
    const zoom = between(1, crop.zoom, MAX_ZOOM);
    const s = scaleOf(image, zoom);
    return {
        zoom,
        x: between(FRAME.x + FRAME.w - image.width * s, crop.x, FRAME.x),
        y: between(FRAME.y + FRAME.h - image.height * s, crop.y, FRAME.y),
    };
}

/** The image at zoom 1, centred in the frame. */
export function initialCrop(image: Size): Crop {
    const s = scaleOf(image, 1);
    return { zoom: 1, x: FRAME.x + (FRAME.w - image.width * s) / 2, y: FRAME.y + (FRAME.h - image.height * s) / 2 };
}

/** `crop` dragged by (dx, dy) stage pixels. */
export const moveCrop = (image: Size, crop: Crop, dx: number, dy: number): Crop =>
    clampCrop(image, { ...crop, x: crop.x + dx, y: crop.y + dy });

/** `crop` zoomed to `zoom` with the stage point (px, py) staying where it is: the cursor of the wheel, or the frame's centre. */
export function zoomCrop(image: Size, crop: Crop, zoom: number, px = FRAME.x + FRAME.w / 2, py = FRAME.y + FRAME.h / 2): Crop {
    const next = between(1, zoom, MAX_ZOOM);
    const k = scaleOf(image, next) / scaleOf(image, crop.zoom);
    return clampCrop(image, { zoom: next, x: px - (px - crop.x) * k, y: py - (py - crop.y) * k });
}

/** What the frame shows of the image. */
export function sourceRect(image: Size, crop: Crop): SourceRect {
    const s = scaleOf(image, crop.zoom);
    return { sx: (FRAME.x - crop.x) / s, sy: (FRAME.y - crop.y) / s, sw: FRAME.w / s, sh: FRAME.h / s };
}

/** Whether two crops show the same part of the image. */
export const sameCrop = (a: Crop, b: Crop) =>
    Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.zoom - b.zoom) < 0.0001;

/**
 * Draws what the frame shows of `image`, whose natural size is `size`, over
 * the whole of `canvas`.
 */
export function drawCrop(canvas: HTMLCanvasElement, image: CanvasImageSource, size: Size, crop: Crop): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { sx, sy, sw, sh } = sourceRect(size, crop);
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
    new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));

/** The portrait as the server takes it: WebP 0.8, or JPEG 0.85 where the canvas cannot make WebP (Safari). */
export async function encodePortrait(image: CanvasImageSource, size: Size, crop: Crop): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT.w;
    canvas.height = OUTPUT.h;
    drawCrop(canvas, image, size, crop);
    const webp = await toBlob(canvas, "image/webp", 0.8);
    if (webp?.type === "image/webp") return webp;
    const jpeg = await toBlob(canvas, "image/jpeg", 0.85);
    if (!jpeg) throw new Error("The browser could not encode the portrait.");
    return jpeg;
}
