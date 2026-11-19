// Bundles the pages into ui/static/dist: the room, with the sheet in it, into
// room.js, the bestiary into bestiary.js and the forum's script into forum.js,
// and writes the client dictionaries i18n.<lang>.js from i18n/catalog.
// `--watch` rebuilds on change without minifying; run the server with -dev so
// it serves the fresh bundles.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { CATALOG_DIR, LANGS, clientDictionary, loadCatalog } from "./i18n/catalog.mjs";

const watch = process.argv.includes("--watch");
const outdir = "ui/static/dist";

const options = {
    entryPoints: {
        room: "ui/static/js/room/main.ts",
        bestiary: "ui/static/js/bestiary/main.tsx",
        forum: "ui/static/js/forum/main.ts",
    },
    outdir,
    bundle: true,
    format: "esm",
    target: "es2022",
    sourcemap: true,
    minify: !watch,
    jsx: "automatic",
    jsxImportSource: "preact",
    // Dev-only checks, such as warning about layouts of missing items.
    define: { __DEV__: String(watch) },
    logLevel: "info",
};

// A classic script that base.html loads before the bundles: ui/static/js/i18n reads the global.
function writeDictionaries() {
    // loadCatalog reads a missing folder as empty, e.g. one a Docker stage didn't copy.
    if (!fs.existsSync(CATALOG_DIR)) {
        console.error(`i18n: no catalog at ${CATALOG_DIR}`);
        return false;
    }
    const { entries, problems } = loadCatalog();
    for (const p of problems) console.error(`i18n: ${p}`);
    fs.mkdirSync(outdir, { recursive: true });
    for (const lang of LANGS) {
        const dictionary = { lang, messages: clientDictionary(entries, lang) };
        fs.writeFileSync(path.join(outdir, `i18n.${lang}.js`), `globalThis.__I18N__ = ${JSON.stringify(dictionary)};\n`);
    }
    console.log(`i18n: wrote ${LANGS.map(l => `i18n.${l}.js`).join(", ")}`);
    return problems.length === 0;
}

if (watch) {
    writeDictionaries();
    // An editor saves a file in several events: write once they settle.
    let timer;
    fs.watch(CATALOG_DIR, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(writeDictionaries, 100);
    });
    const ctx = await esbuild.context(options);
    await ctx.watch();
} else {
    // A catalog file that fails to load would show the bare keys of its strings in the release.
    if (!writeDictionaries()) process.exit(1);
    await esbuild.build(options);
}
