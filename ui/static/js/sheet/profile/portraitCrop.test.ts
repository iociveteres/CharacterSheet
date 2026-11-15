import { describe, expect, it } from "vitest";
import { clampCrop, FRAME, initialCrop, MAX_ZOOM, moveCrop, sameCrop, scaleOf, sourceRect, zoomCrop } from "./portraitCrop";

// A landscape photo: at zoom 1 its height fills the frame.
const photo = { width: 640, height: 480 };

describe("the portrait crop", () => {
    it("starts with the image covering the frame, centred", () => {
        const crop = initialCrop(photo);
        expect(scaleOf(photo, 1)).toBe(0.5);
        expect(crop).toEqual({ zoom: 1, x: FRAME.x + (180 - 320) / 2, y: FRAME.y });
        // The middle 360×480 of the photo.
        expect(sourceRect(photo, crop)).toEqual({ sx: 140, sy: 0, sw: 360, sh: 480 });
    });

    it("covers a portrait image by its width", () => {
        const tall = { width: 300, height: 1000 };
        expect(scaleOf(tall, 1)).toBe(0.6);
        expect(sourceRect(tall, initialCrop(tall))).toEqual({ sx: 0, sy: 300, sw: 300, sh: 400 });
    });

    it("never lets the frame show past the image", () => {
        const crop = initialCrop(photo);
        expect(moveCrop(photo, crop, 500, 500)).toEqual({ zoom: 1, x: FRAME.x, y: FRAME.y });
        expect(moveCrop(photo, crop, -500, -500)).toEqual({ zoom: 1, x: FRAME.x + FRAME.w - 320, y: FRAME.y });
        const rect = sourceRect(photo, moveCrop(photo, crop, -500, 0));
        expect(rect.sx + rect.sw).toBeCloseTo(photo.width);
    });

    it("keeps the zoom between 1 and the maximum", () => {
        const crop = initialCrop(photo);
        expect(zoomCrop(photo, crop, 10).zoom).toBe(MAX_ZOOM);
        expect(zoomCrop(photo, crop, 0.2).zoom).toBe(1);
        expect(clampCrop(photo, { ...crop, zoom: 0 }).zoom).toBe(1);
    });

    it("zooms towards a point, which stays over the same pixel of the image", () => {
        const crop = initialCrop(photo);
        const [px, py] = [100, 80];
        const before = sourceRect(photo, crop);
        const pixelUnder = (rect: typeof before) => [rect.sx + (px - FRAME.x) / FRAME.w * rect.sw, rect.sy + (py - FRAME.y) / FRAME.h * rect.sh];
        const zoomed = zoomCrop(photo, crop, 2, px, py);
        expect(zoomed.zoom).toBe(2);
        const [ax, ay] = pixelUnder(before);
        const [bx, by] = pixelUnder(sourceRect(photo, zoomed));
        expect(bx).toBeCloseTo(ax);
        expect(by).toBeCloseTo(ay);
        expect(sourceRect(photo, zoomed).sw).toBeCloseTo(180);
    });

    it("zooms out towards the frame's centre and back inside the image", () => {
        const deep = zoomCrop(photo, initialCrop(photo), 4, FRAME.x, FRAME.y);
        const out = zoomCrop(photo, deep, 1);
        expect(sameCrop(out, clampCrop(photo, out))).toBe(true);
        const rect = sourceRect(photo, out);
        expect(rect.sx).toBeGreaterThanOrEqual(0);
        expect(rect.sy).toBeGreaterThanOrEqual(-1e-9);
        expect(rect.sx + rect.sw).toBeLessThanOrEqual(photo.width + 1e-9);
    });

    it("tells an unchanged crop from a changed one", () => {
        const crop = initialCrop(photo);
        expect(sameCrop(crop, { ...crop })).toBe(true);
        expect(sameCrop(crop, moveCrop(photo, crop, 5, 0))).toBe(false);
        expect(sameCrop(crop, zoomCrop(photo, crop, 1.01))).toBe(false);
    });
});
