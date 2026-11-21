import { describe, expect, it } from "vitest";
import { stripJpegMetadata } from "./jpeg";

const segment = (marker: number, payload: number[]) => [0xFF, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xFF, ...payload];
const SOS = [0xFF, 0xDA, 0x00, 0x04, 0x01, 0x02, 0xE1, 0xFF, 0xE1, 0xFF, 0xD9];
const jpeg = (...segments: number[][]) => new Uint8Array([0xFF, 0xD8, ...segments.flat(), ...SOS]);

describe("stripJpegMetadata", () => {
    const app0 = segment(0xE0, [1, 2, 3]);
    const dqt = segment(0xDB, [4, 5]);

    it("drops APP1 to APP15 and keeps the rest, the image data untouched", () => {
        const got = stripJpegMetadata(jpeg(app0, segment(0xE1, [9, 9]), dqt, segment(0xE2, [8]), segment(0xEF, []), segment(0xFE, [7])));
        expect([...got]).toEqual([...jpeg(app0, dqt, segment(0xFE, [7]))]);
    });

    it("leaves a JPEG without metadata as it is", () => {
        const clean = jpeg(app0, dqt);
        expect([...stripJpegMetadata(clean)]).toEqual([...clean]);
    });

    it("leaves what it cannot read to the server", () => {
        const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]);
        expect(stripJpegMetadata(webp)).toBe(webp);
        const cut = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x40, 1, 2]);
        expect(stripJpegMetadata(cut)).toBe(cut);
    });
});
