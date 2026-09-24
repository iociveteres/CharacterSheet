// Offline reconciliation of the sheet state: renders every sheet of a dump the
// way the server does, then compares the state scanned from the markup with
// the state built from the embedded JSON. Exits with 1 on any difference that
// is not a documented ghost, or when a sheet does not render at all.
//
//   psql "$DATABASE_URL" -Atc "select json_build_object('id', id, 'kind', sheet_kind, 'content', content) from character_sheets" > sheets.jsonl
//   npm run reconcile:sheets -- --dump sheets.jsonl [--verbose] [--keep]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};

const dump = option("--dump");
if (!dump) {
    console.error("usage: npm run reconcile:sheets -- --dump sheets.jsonl [--verbose] [--keep]");
    process.exit(2);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-reconcile-"));

const render = spawnSync("go", ["test", "./internal/templates", "-run", "^TestRenderSheetsForReconcile$", "-count=1", "-v"], {
    stdio: "inherit",
    env: { ...process.env, SHEET_RECONCILE_DUMP: path.resolve(dump), SHEET_RECONCILE_OUT: outDir },
});
if (render.status !== 0) process.exit(render.status ?? 1);

// Bundled next to node_modules so that packages resolve to the project's copies.
const bundle = path.resolve("node_modules/.cache/reconcile/compare.mjs");
await esbuild.build({
    entryPoints: ["scripts/reconcile/compare.ts"],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    define: { __DEV__: "false" },
    logLevel: "warning",
});

const { reconcileDir } = await import(pathToFileURL(bundle).href);
const failed = await reconcileDir(outDir, path.resolve(dump), { verbose: flag("--verbose") });

if (flag("--keep")) {
    console.log(`rendered fragments kept in ${outDir}`);
} else {
    fs.rmSync(outDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
