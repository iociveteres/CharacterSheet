// The page of `npm run i18n:table`: the whole catalog and the large texts in
// one self-contained HTML file, for reading and proofreading the translation.
// The data goes in as JSON and the page's script builds the rows with
// textContent, so no catalog text is ever parsed as HTML.
import path from "node:path";
import { LANGS, ROOT, isTranslated } from "./catalog.mjs";

/** A link that opens `file` (relative to the repository root) at `line` in VS Code. */
export const editorLink = (file, line = 1) => `vscode://file/${encodeURI(path.resolve(ROOT, file).split(path.sep).join("/").replace(/^\//, ""))}:${line}`;

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --panel: #f5f5f4; --line: #e2e2e0; --text: #1c1c1a; --muted: #6b6b66;
  --accent: #1d5fbf; --warn: #b3261e; --warn-bg: #fdecea; --sel: #e3ecfa; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #18181a; --panel: #222225; --line: #34343a; --text: #e6e6e3; --muted: #9a9a95;
    --accent: #7aa7f0; --warn: #f2948c; --warn-bg: #3a2020; --sel: #26344d; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.4 system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
  padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); }
header h1 { margin: 0; font-size: 16px; }
header input[type=search] { flex: 1 1 240px; padding: 5px 8px; font: inherit; color: inherit; background: var(--bg);
  border: 1px solid var(--line); border-radius: 4px; }
.stats { color: var(--muted); }
.layout { display: flex; align-items: flex-start; }
nav { position: sticky; top: 53px; flex: 0 0 240px; max-height: calc(100vh - 53px); overflow: auto; padding: 8px 0;
  border-right: 1px solid var(--line); }
nav ul { list-style: none; margin: 0; padding-left: 12px; }
nav > ul { padding-left: 4px; }
nav button { display: flex; width: 100%; justify-content: space-between; gap: 8px; padding: 2px 8px; border: 0;
  border-radius: 3px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
nav button:hover { background: var(--line); }
nav button.selected { background: var(--sel); }
nav .count { color: var(--muted); font-size: 12px; }
nav .count.todo { color: var(--warn); }
main { flex: 1; min-width: 0; padding: 8px 16px 32px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { padding: 4px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--muted); font-weight: 600; }
col.key { width: 26%; } col.note { width: 18%; }
tr.file td { padding-top: 14px; font-weight: 600; color: var(--muted); border-bottom-color: var(--text); }
td.key code { font-size: 12.5px; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.where { display: block; font-size: 12px; }
.form { display: block; }
.form b { display: inline-block; min-width: 3.5em; color: var(--muted); font-weight: normal; font-size: 12px; }
td.todo { color: var(--warn); background: var(--warn-bg); }
td.note { color: var(--muted); }
h2 { margin: 24px 0 4px; font-size: 15px; }
.empty { color: var(--muted); padding: 16px 0; }
@media (max-width: 720px) { .layout { display: block; } nav { position: static; max-height: 40vh; border-right: 0;
  border-bottom: 1px solid var(--line); } }
`;

// Runs in the page: builds the tree, the rows and the filters from #data.
function page() {
    const data = JSON.parse(document.getElementById("data").textContent);
    const el = (tag, props = {}, ...children) => {
        const node = Object.assign(document.createElement(tag), props);
        node.append(...children.filter(c => c !== null && c !== undefined));
        return node;
    };
    const isForms = m => m !== null && typeof m === "object";
    const texts = m => (isForms(m) ? Object.values(m) : [m ?? ""]);
    const untranslated = e => e.ru === undefined || texts(e.ru).some(t => !t);
    const message = (m, cell) => {
        if (isForms(m)) for (const [form, text] of Object.entries(m)) cell.append(el("span", { className: "form" }, el("b", { textContent: form }), text));
        else cell.append(m ?? "—");
        return cell;
    };

    // The tree: every prefix of the catalog files, then the large texts under "large texts".
    const root = { path: "", label: "All", children: new Map(), keys: 0, todo: 0 };
    const nodeAt = parts => parts.reduce((node, part, i) => {
        if (!node.children.has(part)) node.children.set(part, { path: parts.slice(0, i + 1).join("."), label: part, children: new Map(), keys: 0, todo: 0 });
        return node.children.get(part);
    }, root);
    for (const e of data.entries) {
        for (let n = e.prefix.split(".").length; n >= 0; n--) {
            const node = nodeAt(e.prefix.split(".").slice(0, n));
            node.keys++;
            if (untranslated(e)) node.todo++;
        }
    }
    const large = { path: "#large", label: "large texts", children: new Map(), keys: data.texts.length, todo: 0 };
    for (const text of data.texts) {
        const group = text.name.split("/")[0];
        if (!large.children.has(group)) large.children.set(group, { path: `#large/${group}`, label: group, children: new Map(), keys: 0, todo: 0 });
        const node = large.children.get(group);
        node.keys++;
        if (!text.files.ru) { node.todo++; large.todo++; }
    }
    if (data.texts.length) root.children.set("#large", large);

    let selected = "";
    const buttons = [];
    const treeItem = node => {
        const button = el("button", { type: "button" }, el("span", { textContent: node.label }),
            el("span", { className: "count" + (node.todo ? " todo" : ""), textContent: node.todo ? `${node.todo} / ${node.keys}` : String(node.keys) }));
        button.dataset.path = node.path;
        button.addEventListener("click", () => { selected = node.path; apply(); });
        buttons.push(button);
        const kids = [...node.children.values()];
        return el("li", {}, button, kids.length ? el("ul", {}, ...kids.map(treeItem)) : null);
    };
    document.querySelector("nav").append(el("ul", {}, treeItem(root)));

    // The rows, in catalog order, with a heading row per file.
    const tbody = document.querySelector("#entries tbody");
    const rows = [];
    let lastFile = null, fileRow = null;
    for (const e of data.entries) {
        if (e.file !== lastFile) {
            lastFile = e.file;
            fileRow = el("tr", { className: "file" }, el("td", { colSpan: 4, textContent: e.file }));
            fileRow.entries = [];
            tbody.append(fileRow);
        }
        const row = el("tr", {},
            el("td", { className: "key" }, el("code", { textContent: e.key }), el("a", { className: "where", href: e.href, textContent: `${e.file}:${e.line}` })),
            message(e.en, el("td", { className: e.en === undefined ? "todo" : "" })),
            message(e.ru, el("td", { className: untranslated(e) ? "todo" : "" })),
            el("td", { className: "note", textContent: e.note ?? "" }));
        row.entry = e;
        row.haystack = [e.key, ...texts(e.en), ...texts(e.ru), e.note ?? ""].join("\n").toLowerCase();
        fileRow.entries.push(row);
        rows.push(row);
        tbody.append(row);
    }
    const fileRows = [...tbody.querySelectorAll("tr.file")];

    const textBody = document.querySelector("#texts tbody");
    const textRows = data.texts.map(text => {
        const link = lang => (text.files[lang]
            ? el("a", { href: text.files[lang].href, textContent: text.files[lang].file })
            : "—");
        const row = el("tr", {}, el("td", {}, el("code", { textContent: text.name })),
            ...data.langs.map(lang => el("td", { className: text.files[lang] ? "" : "todo" }, link(lang))));
        row.text = text;
        row.haystack = [text.name, ...Object.values(text.files).map(f => f.file)].join("\n").toLowerCase();
        textBody.append(row);
        return row;
    });

    const search = document.getElementById("search");
    const todoOnly = document.getElementById("todo");
    function apply() {
        const needle = search.value.trim().toLowerCase();
        const inEntries = selected === "" || !selected.startsWith("#");
        let shown = 0;
        for (const row of rows) {
            const e = row.entry;
            row.hidden = !inEntries
                || (selected && e.prefix !== selected && !e.prefix.startsWith(selected + "."))
                || (todoOnly.checked && !untranslated(e))
                || (needle && !row.haystack.includes(needle));
            if (!row.hidden) shown++;
        }
        for (const fileRow of fileRows) fileRow.hidden = fileRow.entries.every(r => r.hidden);
        let textsShown = 0;
        for (const row of textRows) {
            const group = "#large/" + row.text.name.split("/")[0];
            row.hidden = !(selected === "" || selected === "#large" || selected === group)
                || (todoOnly.checked && row.text.files.ru)
                || (needle && !row.haystack.includes(needle));
            if (!row.hidden) textsShown++;
        }
        document.getElementById("entries").hidden = !shown;
        document.getElementById("texts-section").hidden = !textsShown;
        document.getElementById("empty").hidden = shown + textsShown > 0;
        for (const b of buttons) b.classList.toggle("selected", b.dataset.path === selected);
    }
    search.addEventListener("input", apply);
    todoOnly.addEventListener("change", apply);
    apply();
}

/**
 * @param {{ entries: import("./catalog.mjs").Entry[], texts: { name: string, files: Record<string, string> }[] }} input
 *   texts as largeTexts() gives them
 */
export function renderTable({ entries, texts }) {
    const data = {
        langs: LANGS,
        entries: entries.map(e => ({ key: e.key, file: e.file, line: e.line, prefix: e.prefix, en: e.en, ru: e.ru, note: e.note, href: editorLink(e.file, e.line) })),
        texts: texts.map(t => ({
            name: t.name,
            files: Object.fromEntries(Object.entries(t.files).map(([lang, file]) => [lang, { file, href: editorLink(file) }])),
        })),
    };
    const todo = entries.filter(e => !isTranslated(e, "ru")).length;
    // < escaped so that no text can close the script element.
    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>i18n catalog</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>i18n catalog</h1>
  <span class="stats">${entries.length} keys, ${todo} without ru, ${texts.length} large texts</span>
  <input type="search" id="search" placeholder="Search key, en, ru, note" autofocus>
  <label><input type="checkbox" id="todo"> Not translated</label>
</header>
<div class="layout">
<nav></nav>
<main>
  <table id="entries">
    <colgroup><col class="key"><col><col><col class="note"></colgroup>
    <thead><tr><th>key</th><th>en</th><th>ru</th><th>note</th></tr></thead>
    <tbody></tbody>
  </table>
  <section id="texts-section">
    <h2>Large texts</h2>
    <table id="texts">
      <colgroup><col class="key">${LANGS.map(() => "<col>").join("")}</colgroup>
      <thead><tr><th>text</th>${LANGS.map(lang => `<th>${lang}</th>`).join("")}</tr></thead>
      <tbody></tbody>
    </table>
  </section>
  <p class="empty" id="empty" hidden>Nothing matches.</p>
</main>
</div>
<script type="application/json" id="data">${json}</script>
<script>(${page.toString()})();</script>
</body>
</html>
`;
}
