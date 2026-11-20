// Reads the string catalog of i18n/catalog: one JSON object per file, the
// file path being the key prefix (site/auth.json holds site.auth.*). Shared by
// the build, gen:i18n, the i18n CLI, the table and check:i18n. Reading never
// throws on a bad entry: it returns the problems next to the entries, and
// check:i18n is the one that fails on them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CATALOG_DIR = path.join(ROOT, "i18n", "catalog");
export const LANGS = ["en", "ru"];
export const PLURAL_FORMS = { en: ["one", "other"], ru: ["one", "few", "many"] };
// Sections only the server reads; the client dictionaries leave them out.
export const SERVER_SECTIONS = ["site", "server", "mail", "forum"];

const slash = p => p.split(path.sep).join("/");

/** The key prefix of a catalog file: "site/auth.json" → "site.auth". */
export const prefixOf = relFile => slash(relFile).replace(/\.json$/, "").split("/").join(".");

/** The top-level section of a key or prefix: "site.auth.login" → "site". */
export const sectionOf = key => key.split(".")[0];

export const isClientKey = key => !SERVER_SECTIONS.includes(sectionOf(key));

/** Whether the entry has a message in `lang`, every plural form of it filled. */
export const isTranslated = (entry, lang) => {
    const message = entry[lang];
    if (message !== null && typeof message === "object") return Object.values(message).every(text => typeof text === "string" && text !== "");
    return typeof message === "string" && message !== "";
};

function* jsonFiles(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* jsonFiles(full);
        else if (entry.name.endsWith(".json")) yield full;
    }
}

/** The 1-based line of each `"key":` at the start of an entry, for links into the file. */
function keyLines(text) {
    const lines = new Map();
    text.split(/\r?\n/).forEach((line, i) => {
        const m = line.match(/^\s*"([^"]+)"\s*:/);
        if (m && !lines.has(m[1])) lines.set(m[1], i + 1);
    });
    return lines;
}

/**
 * @typedef {string | Record<string, string>} Message  a string, or plural forms by name
 * @typedef {{ key: string, file: string, prefix: string, line: number, en?: Message, ru?: Message, note?: string }} Entry
 *   file is relative to the repository root, with forward slashes; prefix is the one its path gives
 */

/**
 * @param {string} [dir] the catalog root, i18n/catalog by default (tests pass a fixture)
 * @returns {{ entries: Entry[], byKey: Map<string, Entry>, problems: string[] }}
 */
export function loadCatalog(dir = CATALOG_DIR) {
    const entries = [];
    const byKey = new Map();
    const problems = [];
    for (const full of jsonFiles(dir)) {
        const rel = slash(path.relative(dir, full));
        const file = slash(path.relative(ROOT, full));
        const text = fs.readFileSync(full, "utf8");
        let data;
        try {
            data = JSON.parse(text);
        } catch (err) {
            problems.push(`${file}: not valid JSON: ${err.message}`);
            continue;
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            problems.push(`${file}: the file must hold one object of entries`);
            continue;
        }
        const lines = keyLines(text);
        for (const [key, value] of Object.entries(data)) {
            const entry = { key, file, prefix: prefixOf(rel), line: lines.get(key) ?? 1 };
            if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(entry, value, { key, file, prefix: entry.prefix, line: entry.line });
            else problems.push(`${file}:${entry.line}: ${key}: an entry is an object { "en": …, "ru": …, "note"?: … }`);
            if (byKey.has(key)) problems.push(`${file}:${entry.line}: ${key}: also defined in ${byKey.get(key).file}`);
            entries.push(entry);
            byKey.set(key, entry);
        }
    }
    return { entries, byKey, problems };
}

/**
 * The dictionary of one language for the client: key → message, `en` where `lang` has none, no notes.
 * @returns {Record<string, Message>}
 */
export function clientDictionary(entries, lang) {
    const dict = {};
    for (const e of entries) {
        if (!isClientKey(e.key)) continue;
        const message = e[lang] ?? e.en;
        if (message !== undefined) dict[e.key] = message;
    }
    return dict;
}
