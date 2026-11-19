// Adds the new codes of roll labels to ui/static/js/sheet/rollLabelCodes.golden.json:
// runs its test with UPDATE_ROLL_CODES=1, which writes the file instead of checking it.
import { spawnSync } from "node:child_process";

const run = spawnSync("npx", ["vitest", "run", "ui/static/js/sheet/rollLabelCodes.test.ts"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, UPDATE_ROLL_CODES: "1" },
});
process.exit(run.status ?? 1);
