// Bundles the room page, with the sheet in it, into ui/static/dist/room.js.
// `--watch` rebuilds on change without minifying; run the server with -dev so
// it serves the fresh bundle.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
    entryPoints: ["ui/static/js/room/main.ts"],
    outfile: "ui/static/dist/room.js",
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

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
} else {
    await esbuild.build(options);
}
