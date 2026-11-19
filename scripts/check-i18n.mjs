// npm run check:i18n                 the catalog and the keys the code uses (scripts/i18n/rules.mjs)
// npm run check:i18n -- literals [--list] [folder...]
//                                     interface text still written in the code, by folder
//                                     (scripts/i18n/literals.mjs); the default folders are
//                                     ui/static/js, ui/html, internal/mailer/templates
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./i18n/catalog.mjs";
import { DEFAULT_FOLDERS, applyExceptions, countByFolder, findLiterals, loadExceptions } from "./i18n/literals.mjs";
import { checkAll } from "./i18n/rules.mjs";
import { relToRoot } from "./i18n/sources.mjs";

const USAGE = `usage: npm run check:i18n
       npm run check:i18n -- literals [--list] [folder...]`;

function fail(message) {
    console.error(`${message}\n${USAGE}`);
    process.exit(2);
}

function check() {
    const { catalog, problems } = checkAll();
    if (problems.length) {
        for (const p of problems) console.error(p);
        console.error(`${problems.length} problem(s) in the catalog or its use.`);
        process.exit(1);
    }
    const files = new Set(catalog.entries.map(e => e.file)).size;
    console.log(`The catalog holds ${catalog.entries.length} keys in ${files} files, all translated and used; the code uses no other key.`);
}

function literals(args) {
    const list = args.includes("--list");
    const folders = args.filter(a => a !== "--list");
    const unknown = folders.find(a => a.startsWith("-"));
    if (unknown) fail(`unknown flag ${unknown}`);
    for (const folder of folders) {
        if (!fs.existsSync(path.resolve(ROOT, folder))) fail(`no such folder: ${folder}`);
    }
    const scanFolders = folders.length ? folders.map(relToRoot) : DEFAULT_FOLDERS;
    const scanned = findLiterals(scanFolders);
    const { remaining, excepted, warnings } = applyExceptions(scanned, loadExceptions(), { complete: !folders.length });
    if (list) for (const lit of remaining) console.log(`${lit.file}:${lit.line}: ${lit.text}`);
    for (const [folder, count] of countByFolder(scanFolders, scanned.files, remaining)) {
        console.log(`${String(count).padStart(6)}  ${folder}`);
    }
    console.log(`${String(remaining.length).padStart(6)}  total (${excepted} more in scripts/i18n-literal-exceptions.txt)`);
    for (const w of warnings) console.warn(`warning: ${w}`);
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === undefined) check();
else if (mode === "literals") literals(rest);
else fail(`unknown mode ${mode}`);
