// Browser scenarios of the sheet (e2e/README.md). They drive a running server
// and share its database, so files run one at a time.
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["e2e/scenarios/**/*.e2e.ts"],
        fileParallelism: false,
        testTimeout: 90_000,
        hookTimeout: 90_000,
    },
});
