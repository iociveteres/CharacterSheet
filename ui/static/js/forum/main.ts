// The forum's script: it only improves what the pages already do with forms and links
// (_prd/forum/plan.md): the preview tabs without a reload, Quote with a selection, a spoiler that a
// click opens and closes. It needs no words of its own: the quote head comes from the server.
import { closePreview, openPreview, tabField } from "./preview";
import { quoteOf } from "./quote";

// forum.css opens a spoiler on focus only without the script; with it a click toggles .open.
document.documentElement.classList.add("forum-js");

document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const tab = target.closest<HTMLButtonElement>(".forum-tabs-bar button.tab");
    if (tab) {
        const field = tabField(tab);
        if (!field || tab.classList.contains("current")) return;
        event.preventDefault();
        if (tab.dataset.tab === "preview") void openPreview(tab, field);
        else closePreview(tab.form!);
        return;
    }

    const quote = target.closest<HTMLAnchorElement>("a.forum-quote-post");
    if (quote) {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        quoteHere(event, quote);
        return;
    }

    const spoiler = target.closest(".forum-post-body .spoiler");
    if (spoiler) {
        // A link in an open spoiler is followed, a selection in it is kept.
        if (spoiler.classList.contains("open") && (target.closest("a") || !document.getSelection()?.isCollapsed)) return;
        spoiler.classList.toggle("open");
    }
});

// A press on Quote would clear the selection before the click reads it.
document.addEventListener("mousedown", event => {
    if (event.target instanceof Element && event.target.closest("a.forum-quote-post")) event.preventDefault();
});

document.addEventListener("keydown", event => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches(".forum-post-body .spoiler")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    target.classList.toggle("open");
});

// An empty field hidden under its preview cannot show the browser's message: show the field.
document.addEventListener("invalid", event => {
    const field = event.target;
    if (field instanceof HTMLTextAreaElement && field.hidden && field.form) closePreview(field.form);
}, true);

// With the reply form on this page the quote goes into it, after what is written there, and more
// than one post can be quoted; on another page of the topic the link leads to the form there.
function quoteHere(event: MouseEvent, link: HTMLAnchorElement): void {
    const article = link.closest("article.forum-post");
    const form = document.querySelector<HTMLFormElement>("form#reply");
    const field = form?.querySelector<HTMLTextAreaElement>("textarea[name=body]");
    if (!article || !form || !field) return;
    const text = quoteOf(article, document.getSelection());
    if (!text) return;
    event.preventDefault();
    closePreview(form);
    const before = field.value.replace(/\s+$/, "");
    field.value = before ? `${before}\n\n${text}` : text;
    document.getSelection()?.removeAllRanges();
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
}
