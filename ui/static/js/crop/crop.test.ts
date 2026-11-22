import { afterEach, describe, expect, it, vi } from "vitest";
import {
    clampCrop, encodeCrop, frameRect, initialCrop, MAX_ZOOM, moveCrop, sameCrop, scaleOf, sourceRect, zoomCrop, type CropGeometry, type SourceRect,
} from "./crop";

// The two windows that crop: the sheet's portrait and the site's avatar.
const portrait: CropGeometry = { stage: 300, frame: { w: 180, h: 240 }, output: { w: 360, h: 480 } };
const avatar: CropGeometry = { stage: 300, frame: { w: 240, h: 240 }, output: { w: 192, h: 192 } };

// A landscape photo: at zoom 1 its height fills either frame.
const photo = { width: 640, height: 480 };
const tall = { width: 300, height: 1000 };

describe("the frame", () => {
    it("is centred on the stage", () => {
        expect(frameRect(portrait)).toEqual({ x: 60, y: 30, w: 180, h: 240 });
        expect(frameRect(avatar)).toEqual({ x: 30, y: 30, w: 240, h: 240 });
    });
});

describe("the portrait crop", () => {
    const g = portrait;

    it("starts with the image covering the frame, centred", () => {
        const crop = initialCrop(g, photo);
        expect(scaleOf(g, photo, 1)).toBe(0.5);
        expect(crop).toEqual({ zoom: 1, x: 60 + (180 - 320) / 2, y: 30 });
        // The middle 360×480 of the photo.
        expect(sourceRect(g, photo, crop)).toEqual({ sx: 140, sy: 0, sw: 360, sh: 480 });
    });

    it("covers a portrait image by its width", () => {
        expect(scaleOf(g, tall, 1)).toBe(0.6);
        expect(sourceRect(g, tall, initialCrop(g, tall))).toEqual({ sx: 0, sy: 300, sw: 300, sh: 400 });
    });

    it("never lets the frame show past the image", () => {
        const crop = initialCrop(g, photo);
        expect(moveCrop(g, photo, crop, 500, 500)).toEqual({ zoom: 1, x: 60, y: 30 });
        expect(moveCrop(g, photo, crop, -500, -500)).toEqual({ zoom: 1, x: 60 + 180 - 320, y: 30 });
    });

    it("zooms to half the frame's width at 2", () => {
        expect(sourceRect(g, photo, zoomCrop(g, photo, initialCrop(g, photo), 2, 100, 80)).sw).toBeCloseTo(180);
    });
});

describe("the avatar crop", () => {
    const g = avatar;

    it("starts with the image covering the frame, centred", () => {
        const crop = initialCrop(g, photo);
        expect(scaleOf(g, photo, 1)).toBe(0.5);
        expect(crop).toEqual({ zoom: 1, x: 30 + (240 - 320) / 2, y: 30 });
        // The middle 480×480 of the photo.
        expect(sourceRect(g, photo, crop)).toEqual({ sx: 80, sy: 0, sw: 480, sh: 480 });
    });

    it("covers a portrait image by its width", () => {
        expect(scaleOf(g, tall, 1)).toBe(0.8);
        expect(sourceRect(g, tall, initialCrop(g, tall))).toEqual({ sx: 0, sy: 350, sw: 300, sh: 300 });
    });

    it("never lets the frame show past the image", () => {
        const crop = initialCrop(g, photo);
        expect(moveCrop(g, photo, crop, 500, 500)).toEqual({ zoom: 1, x: 30, y: 30 });
        expect(moveCrop(g, photo, crop, -500, -500)).toEqual({ zoom: 1, x: 30 + 240 - 320, y: 30 });
    });

    it("zooms to half the frame's width at 2", () => {
        expect(sourceRect(g, photo, zoomCrop(g, photo, initialCrop(g, photo), 2, 100, 80)).sw).toBeCloseTo(240);
    });
});

for (const [name, g] of [["portrait", portrait], ["avatar", avatar]] as const) {
    describe(`any crop, on the ${name}'s geometry`, () => {
        const f = frameRect(g);

        it("shows the frame's proportions", () => {
            const rect = sourceRect(g, photo, initialCrop(g, photo));
            expect(rect.sw / rect.sh).toBeCloseTo(g.output.w / g.output.h);
        });

        it("keeps the frame inside the image when dragged", () => {
            const rect = sourceRect(g, photo, moveCrop(g, photo, initialCrop(g, photo), -500, 0));
            expect(rect.sx + rect.sw).toBeCloseTo(photo.width);
        });

        it("keeps the zoom between 1 and the maximum", () => {
            const crop = initialCrop(g, photo);
            expect(zoomCrop(g, photo, crop, 10).zoom).toBe(MAX_ZOOM);
            expect(zoomCrop(g, photo, crop, 0.2).zoom).toBe(1);
            expect(clampCrop(g, photo, { ...crop, zoom: 0 }).zoom).toBe(1);
        });

        it("zooms towards a point, which stays over the same pixel of the image", () => {
            const crop = initialCrop(g, photo);
            const [px, py] = [100, 80];
            const pixelUnder = (rect: SourceRect) => [rect.sx + (px - f.x) / f.w * rect.sw, rect.sy + (py - f.y) / f.h * rect.sh];
            const zoomed = zoomCrop(g, photo, crop, 2, px, py);
            expect(zoomed.zoom).toBe(2);
            const [ax, ay] = pixelUnder(sourceRect(g, photo, crop));
            const [bx, by] = pixelUnder(sourceRect(g, photo, zoomed));
            expect(bx).toBeCloseTo(ax);
            expect(by).toBeCloseTo(ay);
        });

        it("zooms towards the frame's centre by default", () => {
            const crop = initialCrop(g, photo);
            expect(zoomCrop(g, photo, crop, 2)).toEqual(zoomCrop(g, photo, crop, 2, f.x + f.w / 2, f.y + f.h / 2));
        });

        it("zooms out towards the frame's centre and back inside the image", () => {
            const deep = zoomCrop(g, photo, initialCrop(g, photo), 4, f.x, f.y);
            const out = zoomCrop(g, photo, deep, 1);
            expect(sameCrop(out, clampCrop(g, photo, out))).toBe(true);
            const rect = sourceRect(g, photo, out);
            expect(rect.sx).toBeGreaterThanOrEqual(0);
            expect(rect.sy).toBeGreaterThanOrEqual(-1e-9);
            expect(rect.sx + rect.sw).toBeLessThanOrEqual(photo.width + 1e-9);
        });

        it("tells an unchanged crop from a changed one", () => {
            const crop = initialCrop(g, photo);
            expect(sameCrop(crop, { ...crop })).toBe(true);
            expect(sameCrop(crop, moveCrop(g, photo, crop, 5, 0))).toBe(false);
            expect(sameCrop(crop, zoomCrop(g, photo, crop, 1.01))).toBe(false);
        });
    });
}

describe("encoding the crop", () => {
    afterEach(() => vi.restoreAllMocks());

    /** A canvas whose files weigh `bytes(type, quality)`; `webp` false for a browser that cannot make WebP. */
    function canvasOf(bytes: (type: string, quality: number) => number, webp = true) {
        const calls: [string, number][] = [];
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done, type = "image/png", quality = 1) => {
            calls.push([type, quality]);
            const made = type === "image/webp" && !webp ? "image/png" : type;
            done(new Blob([new Uint8Array(bytes(made, quality))], { type: made }));
        });
        return calls;
    }
    const encode = (g: CropGeometry) => encodeCrop(g, document.createElement("canvas"), photo, initialCrop(g, photo));

    it("encodes a light crop once", async () => {
        const calls = canvasOf(() => 1000);
        const blob = await encode({ ...avatar, maxBytes: 2000 });
        expect(blob.type).toBe("image/webp");
        expect(calls).toEqual([["image/webp", 0.8]]);
    });

    it("encodes a crop over the limit again at a lower quality, in the same format", async () => {
        const calls = canvasOf((_, quality) => quality > 0.6 ? 3000 : 1500);
        const blob = await encode({ ...avatar, maxBytes: 2000 });
        expect(blob.size).toBe(1500);
        expect(calls).toEqual([["image/webp", 0.8], ["image/webp", 0.6]]);

        const jpegCalls = canvasOf((_, quality) => quality > 0.6 ? 3000 : 1500, false);
        expect((await encode({ ...avatar, maxBytes: 2000 })).type).toBe("image/jpeg");
        expect(jpegCalls).toEqual([["image/webp", 0.8], ["image/jpeg", 0.85], ["image/jpeg", 0.6]]);
    });

    it("leaves a geometry without a limit, the portrait's, as it is", async () => {
        const calls = canvasOf(() => 1 << 20);
        await encode(portrait);
        expect(calls).toEqual([["image/webp", 0.8]]);
    });
});
