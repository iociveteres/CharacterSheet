// Writes ui/static/js/i18n/keys.gen.ts from i18n/catalog: the client keys and
// the params of each, so that t() with a wrong key or a missing param fails
// `npm run typecheck`. CI checks that the file is current.
import fs from "node:fs";
import path from "node:path";
import { LANGS, ROOT, isClientKey, loadCatalog } from "./i18n/catalog.mjs";

const KEYS_FILE = path.join(ROOT, "ui", "static", "js", "i18n", "keys.gen.ts");

/** The params of an entry: the `{name}`s of its messages in every language, and `count` for plural forms. */
function paramsOf(entry) {
    const names = new Set();
    for (const lang of LANGS) {
        const message = entry[lang];
        if (message == null) continue;
        if (typeof message === "object") names.add("count");
        for (const text of typeof message === "string" ? [message] : Object.values(message)) {
            for (const m of String(text).matchAll(/\{(\w+)\}/g)) names.add(m[1]);
        }
    }
    return [...names].sort();
}

function keysSource(entries) {
    const lines = entries
        .filter(e => isClientKey(e.key))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map(e => {
            const params = paramsOf(e).map(name => `${JSON.stringify(name)}: ${name === "count" ? "number" : "string | number"}`);
            return `    ${JSON.stringify(e.key)}: {${params.length ? ` ${params.join("; ")} ` : ""}};`;
        });
    return [
        "// Source: i18n/catalog, the client sections.",
        "// Regenerate with `npm run gen:i18n`.",
        "",
        "export interface I18nParams {",
        ...lines,
        "}",
        "",
        "export type I18nKey = keyof I18nParams;",
        "",
    ].join("\n");
}

const { entries, problems } = loadCatalog();
if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
}
fs.writeFileSync(KEYS_FILE, keysSource(entries));
console.log(`Wrote ${path.relative(ROOT, KEYS_FILE)}`);
