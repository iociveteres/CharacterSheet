// The catalog keys the code uses, for check:i18n. A key counts as used when it
// is written out as a string literal in one of these calls:
//
//   client (ui/static/js)  t("full.key", …)   t('full.key')   t(`full.key`) without ${}
//   Go                     i18n.T(lang, "full.key", …)   the key is the second argument
//   Go templates           {{t .Lang "full.key"}}   (t $.Lang "full.key" "count" 3)
//
// A key built at run time (t(`sheet.weapons.grip.${grip}`)) can't be found that
// way: mark the keys it may take with a comment in the same file, in any of
// the three kinds:
//
//   // i18n-keys: sheet.weapons.grip.*, sheet.weapons.reach
//   {{/* i18n-keys: site.nav.lang.* */}}
//
// `prefix.*` covers every key under the prefix, a full key covers itself; the
// list is separated by commas or spaces and ends with the line. A marker that
// covers no catalog key is a problem, so markers don't outlive their keys.
import fs from "node:fs";
import ts from "typescript";
import { isClientSource, lineAt, relToRoot, walk } from "./sources.mjs";

export const DEFAULT_ROOTS = {
    client: ["ui/static/js"],
    go: ["."],
    templates: ["ui/html", "internal/mailer/templates", "internal/forum/templates"],
};

const MARKER = /i18n-keys:([^\n]*)/g;
// The first argument is any expression without commas or parens at its top level: lang, r.Lang, app.lang.
const GO_CALL = /\bT\(\s*[^,()]+,\s*"([^"]+)"/g;
const TEMPLATE_ACTION = /\{\{-?([\s\S]*?)-?\}\}/g;
const TEMPLATE_CALL = /(?:^|[\s(])t\s+[^\s"()`]+\s+["`]([^"`]+)["`]/g;

function markers(text, file) {
    const found = [];
    for (const m of text.matchAll(MARKER)) {
        const list = m[1].replace(/\*\/[\s\S]*|-->[\s\S]*|\}\}[\s\S]*/, "");
        for (const pattern of list.split(/[\s,]+/).filter(Boolean)) {
            found.push({ pattern, file, line: lineAt(text, m.index) });
        }
    }
    return found;
}

function clientKeys(text, file) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const found = [];
    const visit = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
            const arg = node.arguments[0];
            if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
                found.push({ key: arg.text, file, line: source.getLineAndCharacterOfPosition(arg.getStart()).line + 1 });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

function regexKeys(text, file, pattern) {
    return [...text.matchAll(pattern)].map(m => ({ key: m[1], file, line: lineAt(text, m.index) }));
}

function templateKeys(text, file) {
    const found = [];
    for (const action of text.matchAll(TEMPLATE_ACTION)) {
        for (const call of action[1].matchAll(TEMPLATE_CALL)) {
            found.push({ key: call[1], file, line: lineAt(text, action.index + action[0].indexOf(action[1]) + call.index) });
        }
    }
    return found;
}

/**
 * @param {{ client?: string[], go?: string[], templates?: string[] }} [roots] folders relative to the repository root
 * @returns {{ uses: { key: string, file: string, line: number }[], markers: { pattern: string, file: string, line: number }[] }}
 */
export function findUsage(roots = DEFAULT_ROOTS) {
    const uses = [];
    const found = [];
    const scan = (dirs = [], accept, keysOf) => {
        for (const dir of dirs) {
            for (const abs of walk(dir, accept)) {
                const text = fs.readFileSync(abs, "utf8");
                const file = relToRoot(abs);
                uses.push(...keysOf(text, file));
                found.push(...markers(text, file));
            }
        }
    };
    scan(roots.client, isClientSource, clientKeys);
    scan(roots.go, name => name.endsWith(".go") && !name.endsWith("_test.go"), (text, file) => regexKeys(text, file, GO_CALL));
    scan(roots.templates, name => name.endsWith(".html"), templateKeys);
    return { uses, markers: found };
}

/** Whether marker `pattern` covers `key`. */
export const covers = (pattern, key) => (pattern.endsWith(".*") ? key.startsWith(pattern.slice(0, -1)) : key === pattern);
