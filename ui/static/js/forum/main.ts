// The forum's script: it only improves what the pages already do with forms and links
// (_prd/forum/plan.md): the preview tabs without a reload, Quote with a selection, a spoiler that a
// click opens and closes, the line of a picture that did not load, a parent folded on the home
// without a reload. It needs no words of its own: the quote head, that line and the fold arrow's
// labels come from the server.
import { toggleFold } from "./fold";
import { showBroken } from "./images";
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

// A field with a counter (the user's «About»: "131 / 500") counts as it is typed; the server wrote
// the count of the page. Characters, not UTF-16 units, as the server counts them.
document.addEventListener("input", event => {
    const field = event.target;
    if (!(field instanceof HTMLTextAreaElement) || !field.dataset.counter) return;
    const counter = document.getElementById(field.dataset.counter);
    if (counter) counter.textContent = String([...field.value].length);
});

// error does not bubble, and a lazy picture fails only once its spoiler opens, long after the page
// loaded: the capture phase on document hears every one of them.
document.addEventListener("error", event => {
    if (event.target instanceof HTMLImageElement) showBroken(event.target);
}, true);

// The fold arrow of a parent on the home is a form that reloads the page; here the rows fold at
// once, and the same form goes in the background for the cookie that keeps it.
document.addEventListener("submit", event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("form.forum-fold")) return;
    if (!toggleFold(form)) return;
    event.preventDefault();
    // manual: the answer is a redirect to the home, which nobody needs to load; the cookie comes
    // with the redirect.
    void fetch(form.action, { method: "POST", body: new FormData(form), redirect: "manual" }).catch(() => {});
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
