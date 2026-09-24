// Offline reconciliation, run by scripts/reconcile-sheets.mjs: for every sheet
// fragment rendered by TestRenderSheetsForReconcile, compare the state scanned
// from the markup with the state built from its #sheet-state JSON.

import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { domToSignals } from "../../ui/static/js/sheet/state/builder.js";
import { normalizeSheet } from "../../ui/static/js/sheet/schema/normalize";
import { jsonToSignals, type SignalTree } from "../../ui/static/js/sheet/state/fromJson";
import { compareTrees, formatDiff, type TreeDiff } from "../../ui/static/js/sheet/state/reconcile";

type Root = DocumentFragment;

/**
 * Brings form controls parsed by happy-dom to the state a browser gives them.
 * happy-dom picks the wrong option for `selected`, does not sanitize input
 * values and keeps every `checked` radio of a group.
 */
function matchBrowser(root: Root) {
    for (const select of root.querySelectorAll("select")) {
        const options = Array.from(select.options);
        let index = -1;
        options.forEach((o, i) => { if (o.hasAttribute("selected")) index = i; });
        if (index < 0) index = options.findIndex(o => !o.disabled);
        select.selectedIndex = index;
    }

    for (const textarea of root.querySelectorAll("textarea")) {
        // The parser drops a newline right after <textarea> and turns CRLF into LF.
        textarea.value = (textarea.textContent ?? "").replace(/\r\n?/g, "\n").replace(/^\n/, "");
    }

    const FLOAT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    const groups = new Map<string, HTMLInputElement[]>();
    for (const input of root.querySelectorAll("input")) {
        const type = (input.getAttribute("type") ?? "text").toLowerCase();
        const value = (input.getAttribute("value") ?? "").replace(/\r\n?/g, "\n");
        if (type === "text") {
            input.value = value.replace(/\n/g, "");
        } else if (type === "number") {
            input.value = FLOAT.test(value) ? value : "";
        } else if (type === "radio") {
            input.checked = input.hasAttribute("checked");
            const name = input.getAttribute("name") ?? "";
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name)!.push(input);
        }
    }
    // Only the last checked radio of a group stays checked.
    for (const radios of groups.values()) {
        const checked = radios.filter(r => r.checked);
        checked.slice(0, -1).forEach(r => { r.checked = false; });
    }
}

export interface SheetResult {
    file: string;
    /** State from the markup against state from the JSON. */
    diffs: TreeDiff[];
    /** State from the JSON against state from the raw stored content. */
    rawDiffs: TreeDiff[];
    ghosts: string[];
}

/**
 * `raw` is the content as stored, before the Go structs. Normalizing it must
 * give what normalizing the serialized struct gives: the schema defaults are
 * the Go zero values as the templates show them.
 */
export function reconcileFile(win: Window, file: string, raw?: unknown): SheetResult {
    const html = fs.readFileSync(file, "utf8");
    const doc = new win.DOMParser().parseFromString(html, "text/html");

    const template = doc.querySelector("template[shadowrootmode]") as HTMLTemplateElement | null;
    const stateScript = doc.getElementById("sheet-state");
    if (!template || !stateScript) throw new Error(`${file}: no shadow root template or #sheet-state`);

    const root = template.content as unknown as Root;
    matchBrowser(root);
    const domTree = domToSignals(root) as SignalTree;

    const { content } = JSON.parse(stateScript.textContent ?? "");
    const ghosts: string[] = [];
    const state = normalizeSheet(content, { onGhost: (grid, id) => ghosts.push(`${grid}.${id}`) });
    const jsonTree = jsonToSignals(state);
    const diffs = compareTrees(domTree, jsonTree, ghosts);

    const rawDiffs = raw === undefined ? [] : compareTrees(
        jsonToSignals(normalizeSheet(raw, { onGhost: () => { } })), jsonTree);

    return { file: path.basename(file), diffs, rawDiffs, ghosts };
}

function readDump(dumpPath: string): Map<string, unknown> {
    const contents = new Map<string, unknown>();
    for (const line of fs.readFileSync(dumpPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const { id, content } = JSON.parse(line);
        contents.set(String(id), content);
    }
    return contents;
}

interface UnrenderedSheet {
    id: number;
    error: string;
}

function readUnrendered(dir: string): UnrenderedSheet[] {
    const file = path.join(dir, "unrendered.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

/**
 * Reconciles every rendered sheet in `dir` against its dump line. Returns the
 * number of sheets with unexpected differences or that did not render.
 */
export async function reconcileDir(dir: string, dumpPath: string, { verbose = false } = {}): Promise<number> {
    const rawContents = readDump(dumpPath);
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".html"))
        .sort((a, b) => parseInt(a) - parseInt(b));

    let failed = 0;
    let ghostSheets = 0;
    for (const f of files) {
        // happy-dom frees parsed documents only when their window closes.
        const win = new Window();
        // getDataPath looks up the sheet host in the global document.
        (globalThis as { document?: unknown }).document = win.document;
        let result: SheetResult;
        try {
            result = reconcileFile(win, path.join(dir, f), rawContents.get(path.parse(f).name));
        } finally {
            await win.happyDOM.close();
        }

        const { file, diffs, rawDiffs, ghosts } = result;
        const unexpected = diffs.filter(d => !d.ghost);
        const ghostDiffs = diffs.length - unexpected.length;
        if (ghosts.length) ghostSheets++;
        if (unexpected.length || rawDiffs.length) failed++;

        if (unexpected.length || verbose) {
            console.log(`${file}: ${unexpected.length} differences, ${ghosts.length} ghosts (${ghostDiffs} ghost fields)`);
            for (const d of verbose ? diffs : unexpected) console.log(`  ${formatDiff(d)}`);
        }
        if (rawDiffs.length) {
            console.log(`${file}: ${rawDiffs.length} differences between the raw and the serialized content`);
            for (const d of rawDiffs) console.log(`  ${formatDiff(d).replace("markup", "serialized").replace("json", "raw")}`);
        }
        if (ghosts.length && !verbose) {
            console.log(`${file}: ghosts ${ghosts.join(", ")}`);
        }
    }

    const unrendered = readUnrendered(dir);
    for (const { id, error } of unrendered) {
        console.log(`${id}: not rendered: ${error}`);
    }
    // A failure: these sheets do not open on the server either.
    failed += unrendered.length;

    console.log(`\n${files.length} sheets, ${failed - unrendered.length} with differences, ${ghostSheets} with ghosts, `
        + `${unrendered.length} not rendered`);
    return failed;
}
