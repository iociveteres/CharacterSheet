// Walking the source tree for check:i18n and the table: which files to read,
// lines of a match, and the large texts kept whole per language.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./catalog.mjs";

// testdata also keeps the fixtures of these scripts out of the real scan, as
// it keeps them out of `go vet`.
const SKIP_NAMES = new Set(["node_modules", ".git", ".claude", "_prd", "testdata"]);
const SKIP_PATHS = new Set(["ui/static/dist", "internal/gamedata/assets"]);

// The folders of the large texts: <name>.<lang>.html, see "Крупные тексты" in _prd/i18n/plan.md.
export const LARGE_TEXT_DIRS = { content: "ui/html/content", mail: "internal/mailer/templates" };

export const slash = p => p.split(path.sep).join("/");
export const relToRoot = file => slash(path.relative(ROOT, path.resolve(ROOT, file)));

/** Every file under `dir` (relative to the repository root or absolute) that `accept` takes by its name. */
export function* walk(dir, accept) {
    const abs = path.resolve(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isFile()) {
        if (accept(path.basename(abs))) yield abs;
        return;
    }
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(abs, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_NAMES.has(entry.name) && !SKIP_PATHS.has(relToRoot(full))) yield* walk(full, accept);
        } else if (accept(entry.name)) yield full;
    }
}

/** The 1-based line of `index` in `text`. */
export const lineAt = (text, index) => {
    let line = 1;
    for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) line++;
    return line;
};

export const isClientSource = name => /\.(m?js|tsx?)$/.test(name) && !/\.test\.[mc]?[jt]sx?$/.test(name)
    && !name.endsWith(".gen.ts") && !name.endsWith(".d.ts") && !/^testUtils\.[jt]sx?$/.test(name);

/**
 * The large texts of the folders, by name: { name: "content/about", dir, files: { en: "ui/html/content/about.en.html", ... } }.
 * A file whose language isn't one of LANGS lands in `files` too, under that language.
 * Files without a language suffix are left out: the mail templates get one in block 3.
 * @param {Record<string, string>} [dirs] label → folder relative to the repository root
 */
export function largeTexts(dirs = LARGE_TEXT_DIRS) {
    const texts = new Map();
    for (const [label, dir] of Object.entries(dirs)) {
        for (const file of walk(dir, name => /^[^.]+\.[a-z]{2}\.html$/.test(name))) {
            const [, base, lang] = path.basename(file).match(/^([^.]+)\.([a-z]{2})\.html$/);
            const name = [label, slash(path.relative(path.resolve(ROOT, dir), path.dirname(file))), base].filter(Boolean).join("/");
            if (!texts.has(name)) texts.set(name, { name, dir, files: {} });
            texts.get(name).files[lang] = relToRoot(file);
        }
    }
    return [...texts.values()].sort((a, b) => a.name.localeCompare(b.name));
}
