// Reads the files of a ZIP archive, enough for the archives the server writes (archive/zip:
// stored or deflated, no ZIP64).
import { inflateRawSync } from "node:zlib";

/** The files of the archive by path. */
export function unzip(data: Buffer): Map<string, Buffer> {
    // Go writes the sizes after the data (a data descriptor), so they are read from the central
    // directory, whose offset the end record at the tail holds.
    const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0) throw new Error("Not a ZIP archive: no end of central directory");
    const count = data.readUInt16LE(end + 10);
    let at = data.readUInt32LE(end + 16);
    const files = new Map<string, Buffer>();
    for (let i = 0; i < count; i++) {
        if (data.readUInt32LE(at) !== 0x02014b50) throw new Error(`Broken central directory at ${at}`);
        const method = data.readUInt16LE(at + 10);
        const size = data.readUInt32LE(at + 20);
        const nameLength = data.readUInt16LE(at + 28);
        const local = data.readUInt32LE(at + 42);
        const name = data.toString("utf8", at + 46, at + 46 + nameLength);
        at += 46 + nameLength + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);

        const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
        const raw = data.subarray(start, start + size);
        if (method === 0) files.set(name, raw);
        else if (method === 8) files.set(name, inflateRawSync(raw));
        else throw new Error(`${name}: compression method ${method}`);
    }
    return files;
}
