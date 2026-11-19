// Saving an edit from the table of `npm run i18n:edit`. Every catalog entry
// sits on one line, so a save rewrites that line alone: the rest of the file,
// its line endings and the line numbers the table links to stay as they were.
import fs from "node:fs";
import path from "node:path";
import { LANGS, ROOT, loadCatalog } from "./catalog.mjs";
import { checkEntries } from "./rules.mjs";

export const EDITABLE_FIELDS = [...LANGS, "note"];

const isForms = m => m !== null && typeof m === "object" && !Array.isArray(m);

/** A cleared field is left out of the entry: "" and plural forms that are all empty. */
export const normalize = value => {
    if (isForms(value)) return Object.values(value).every(text => text === "") ? undefined : value;
    return value === "" || value === null ? undefined : value;
};

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export class Conflict extends Error {
    constructor(current) {
        super("the entry has changed in the file since the page was loaded");
        this.current = current;
    }
}

// The style of the catalog: { "en": …, "ru": … } with spaces, plural forms as {"one": …, "other": …}.
const formatMessage = m => (isForms(m)
    ? `{${Object.entries(m).map(([form, text]) => `${JSON.stringify(form)}: ${JSON.stringify(text)}`).join(", ")}}`
    : JSON.stringify(m));
const formatEntry = fields => `{ ${Object.entries(fields).map(([name, m]) => `${JSON.stringify(name)}: ${formatMessage(m)}`).join(", ")} }`;

/**
 * Sets `field` of `key` in the text of a catalog file to `after`, if it still holds `before`.
 * @returns {{ text: string, fields: Record<string, unknown> }} the new file text and the entry's fields
 * @throws {Conflict} when the field holds something else than `before`
 */
export function updateEntryText(text, key, field, before, after) {
    if (!EDITABLE_FIELDS.includes(field)) throw new Error(`${field} is not one of ${EDITABLE_FIELDS.join(", ")}`);
    if (field === "note" ? !(after === null || typeof after === "string")
        : !(after === null || typeof after === "string" || (isForms(after) && Object.values(after).every(t => typeof t === "string")))) {
        throw new Error(`${field}: a string${field === "note" ? "" : " or an object of plural forms"} is expected`);
    }
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    const head = JSON.stringify(key) + ":";
    const i = lines.findIndex(line => line.trimStart().startsWith(head));
    if (i === -1) throw new Error(`${key} is not on a line of its own`);
    const [, indent, body, comma] = lines[i].match(/^(\s*)(.*?)(,?)\s*$/);
    const fields = JSON.parse(`{${body}}`)[key];
    if (!same(fields[field], normalize(before))) throw new Conflict(fields);

    const value = normalize(after);
    const next = {};
    // en, ru and note in that order, as in the rest of the catalog.
    for (const name of [...EDITABLE_FIELDS, ...Object.keys(fields)]) {
        const v = name === field ? value : fields[name];
        if (v !== undefined && !(name in next)) next[name] = v;
    }
    lines[i] = `${indent}${head} ${formatEntry(next)}${comma}`;
    // The new text must still be one valid file.
    JSON.parse(lines.join("\n"));
    return { text: lines.join(eol), fields: next };
}

/**
 * Saves one field of a catalog entry; the file is the one the catalog has the key in.
 * @returns {{ fields: Record<string, unknown>, problems: string[] }} the entry as saved and what check:i18n will say about it
 */
export function saveEntry({ key, field, before, after }, catalogDir) {
    const entry = loadCatalog(catalogDir).byKey.get(key);
    if (!entry) throw new Error(`${key} is not in the catalog`);
    const file = path.resolve(ROOT, entry.file);
    const { text, fields } = updateEntryText(fs.readFileSync(file, "utf8"), key, field, before, after);
    fs.writeFileSync(file, text);
    const at = `${entry.file}:${entry.line}: ${key}: `;
    const problems = checkEntries({ entries: [{ ...fields, key, file: entry.file, prefix: entry.prefix, line: entry.line }], problems: [] })
        .map(p => (p.startsWith(at) ? p.slice(at.length) : p));
    return { fields, problems };
}
