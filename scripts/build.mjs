// Bundles the sheet into ui/static/dist/sheet.js. `--watch` rebuilds on change
// without minifying; run the server with -dev so it serves the fresh bundle.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
    entryPoints: ["ui/static/js/sheet/script.js"],
    outfile: "ui/static/dist/sheet.js",
    bundle: true,
    format: "esm",
    target: "es2022",
    sourcemap: true,
    minify: !watch,
    jsx: "automatic",
    jsxImportSource: "preact",
    logLevel: "info",
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
} else {
    await esbuild.build(options);
}
