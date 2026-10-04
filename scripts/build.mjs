// Bundles the pages into ui/static/dist: the room, with the sheet in it, into
// room.js and the bestiary into bestiary.js. `--watch` rebuilds on change
// without minifying; run the server with -dev so it serves the fresh bundles.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
    entryPoints: {
        room: "ui/static/js/room/main.ts",
        bestiary: "ui/static/js/bestiary/main.tsx",
    },
    outdir: "ui/static/dist",
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
