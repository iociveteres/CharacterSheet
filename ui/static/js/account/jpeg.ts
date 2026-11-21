// The server refuses a public image with metadata (carriesMetadata in
// internal/webapp/images.go). A canvas writes none in WebP, but the JPEG
// that Safari's canvas makes may carry APP segments of its own; they go
// before the upload.

/**
 * The JPEG without its APP1–APP15 segments (EXIF, XMP, ICC...). The image
 * data after SOS stays as it is; a file that is not a JPEG, or whose segments
 * do not add up, comes back unchanged for the server to judge.
 */
export function stripJpegMetadata(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    if (data[0] !== 0xFF || data[1] !== 0xD8) return data;
    const kept: Uint8Array<ArrayBuffer>[] = [data.subarray(0, 2)];
    let i = 2;
    for (;;) {
        if (i + 4 > data.length || data[i] !== 0xFF) return data;
        const marker = data[i + 1];
        // SOS: the image data, which has no segments to read.
        if (marker === 0xDA) break;
        const end = i + 2 + ((data[i + 2] << 8) | data[i + 3]);
        if (end > data.length) return data;
        if (marker < 0xE1 || marker > 0xEF) kept.push(data.subarray(i, end));
        i = end;
    }
    kept.push(data.subarray(i));
    const out = new Uint8Array(kept.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of kept) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}
