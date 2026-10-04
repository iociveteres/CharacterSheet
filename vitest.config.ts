import { defineConfig } from "vitest/config";

export default defineConfig({
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
        include: ["ui/static/js/**/*.test.{js,ts,tsx}", "scripts/**/*.test.mjs"],
    },
});
