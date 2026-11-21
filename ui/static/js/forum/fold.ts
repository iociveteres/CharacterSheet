// The fold arrow of a parent on the home (_prd/forum/subsections, «Сворачивание»). The server
// renders the class folded from the cookie forum_folded on the parent's row and its subsections'
// rows, and the row carries both faces of the parent, so folding is only a class: no row is asked
// of the server again.

// toggleFold folds or unfolds the parent of the arrow's form with its subsections, and words the
// arrow for what the next press does; false if the form is not in a parent's row.
export function toggleFold(form: HTMLFormElement): boolean {
    const parent = form.closest<HTMLElement>(".forum-parent");
    const button = form.querySelector<HTMLButtonElement>("button");
    if (!parent?.dataset.section || !button) return false;
    const folded = parent.classList.toggle("folded");
    for (const row of document.querySelectorAll(`.forum-subrow[data-parent="${parent.dataset.section}"]`)) {
        row.classList.toggle("folded", folded);
    }
    const label = (folded ? button.dataset.unfold : button.dataset.fold) ?? "";
    button.setAttribute("aria-expanded", String(!folded));
    button.title = label;
    button.setAttribute("aria-label", label);
    return true;
}
