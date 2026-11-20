// A picture of a post that did not load (removed, its host down or blocked for this reader, an
// address of a page rather than a file) gives its place to the line the server put after it:
// "The picture did not load: caption · host", a link to the address (internal/forum/images.go).
// Without the script the browser shows its broken picture with the caption.

/** Shows the line of a broken picture `img` in its place; the picture stays in the page, hidden, so
 * that a quote still finds its caption and address. */
export function showBroken(img: HTMLImageElement): void {
    if (!img.classList.contains("forum-img")) return;
    const link = img.closest<HTMLElement>("a.forum-img-link");
    const line = link?.nextElementSibling;
    if (!link || !(line instanceof HTMLElement) || !line.classList.contains("forum-img-broken")) return;
    link.hidden = true;
    line.hidden = false;
}
