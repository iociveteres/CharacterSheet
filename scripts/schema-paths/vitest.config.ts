// Runs paths.gen.ts alone: `npm run gen:schema-paths`. Same environment as
// the unit tests, as importing the sheet kinds imports their components.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    define: {
        __DEV__: "true",
    },
    oxc: {
        jsx: {
            runtime: "automatic",
            importSource: "preact",
        },
    },
    test: {
        environment: "happy-dom",
        include: ["scripts/schema-paths/paths.gen.ts"],
    },
});
