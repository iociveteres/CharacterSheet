// The Text / Preview tabs over the message field (internal/forum/templates/editor.html) without a
// reload: the preview is the server's fragment (POST /forum/preview) in the place of the field, of
// its height. Without the script each tab is a submit button and the server sends the form back on
// the other tab; when the fragment fails, the tab does just that.

const PREVIEW_URL = "/forum/preview";

// Clicks on a tab while its preview is on its way: an answer to an older one is dropped.
const requests = new WeakMap<HTMLFormElement, number>();

/** The field the tabs of `button` switch, or null when the server drew the form on its Preview tab
 * (the field is a hidden input then) and the tab has to go to the server. */
export function tabField(button: HTMLButtonElement): HTMLTextAreaElement | null {
    if (!button.closest(".forum-tabs-bar")) return null;
    return button.form?.querySelector<HTMLTextAreaElement>("textarea[name=body]") ?? null;
}

/** Shows the preview of the field's text in its place; on any failure submits the form with the
 * tab, as without the script. */
export async function openPreview(button: HTMLButtonElement, field: HTMLTextAreaElement): Promise<void> {
    const form = button.form!;
    const request = (requests.get(form) ?? 0) + 1;
    requests.set(form, request);
    let html: string;
    try {
        const token = form.querySelector<HTMLInputElement>("input[name=csrf_token]")?.value ?? "";
        const response = await fetch(PREVIEW_URL, {
            method: "POST",
            body: new URLSearchParams({ csrf_token: token, body: field.value }),
            credentials: "same-origin",
        });
        // A guest (403), a text over the limit (422): the form's own answer says why.
        if (!response.ok) throw new Error(`preview: ${response.status}`);
        html = await response.text();
    } catch {
        if (requests.get(form) === request) form.requestSubmit(button);
        return;
    }
    if (requests.get(form) !== request) return;

    let preview = form.querySelector<HTMLElement>(".tab-preview");
    if (!preview) {
        preview = form.ownerDocument.createElement("div");
        preview.className = "tab-preview forum-post-body";
        preview.id = `${field.id}-preview`;
        field.before(preview);
    }
    // The fragment is the server's rendering of Markdown without raw HTML, as on the topic page.
    preview.innerHTML = html;
    if (field.offsetHeight > 0) preview.style.minHeight = `${field.offsetHeight}px`;
    field.hidden = true;
    selectTab(button.closest(".forum-tabs-bar")!, "preview");
}

/** Back to the field from the preview, the text as it was. */
export function closePreview(form: HTMLFormElement): void {
    requests.set(form, (requests.get(form) ?? 0) + 1);
    const field = form.querySelector<HTMLTextAreaElement>("textarea[name=body]");
    if (!field) return;
    form.querySelector(".tab-preview")?.remove();
    field.hidden = false;
    const bar = form.querySelector(".forum-tabs-bar");
    if (bar) selectTab(bar, "text");
}

// The current tab is a plain button, the other one submits: as the server draws them.
function selectTab(bar: Element, current: string): void {
    for (const tab of Array.from(bar.querySelectorAll<HTMLButtonElement>("button.tab"))) {
        const on = tab.dataset.tab === current;
        tab.classList.toggle("current", on);
        tab.type = on ? "button" : "submit";
        if (on) tab.setAttribute("aria-current", "true");
        else tab.removeAttribute("aria-current");
    }
}
