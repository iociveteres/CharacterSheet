// PreToolUse hook on Read: a large text file read whole fills the context, so ask for a range.
import { readFileSync, statSync } from "node:fs";

const LIMIT = 40 * 1024;
// Images and PDFs are read as media, not text; the Read tool has its own rules for them.
const MEDIA = /\.(png|jpe?g|gif|webp|svg|pdf|ipynb)$/i;

let input;
try {
    input = JSON.parse(readFileSync(0, "utf8"));
} catch {
    process.exit(0);
}
const { file_path: path, offset, limit } = input.tool_input ?? {};
if (!path || offset != null || limit != null || MEDIA.test(path)) process.exit(0);

let size;
try {
    size = statSync(path).size;
} catch {
    process.exit(0);
}
if (size <= LIMIT) process.exit(0);

const kb = Math.round(size / 1024);
console.log(JSON.stringify({
    hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
            `${path} is ${kb} KB. Find the place with Grep (output_mode "content", -n, -C) ` +
            `and Read only that range with offset/limit.`,
    },
}));
