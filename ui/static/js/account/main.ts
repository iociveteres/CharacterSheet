// Entry point of the Account page bundle (ui/html/pages/account.html): the
// name renamed in place and the avatar block's crop window. Without this script
// the page shows the name and the avatar as the server draws them; under a
// moderator's lock there is nothing to upload, so the server's block stays.
import { h, render } from "preact";
import { AvatarRow } from "./Avatar";
import { NameRow, type FormerName } from "./Name";

const nameCell = document.getElementById("account-name");
if (nameCell) {
    let former: FormerName[] = [];
    try {
        former = JSON.parse(nameCell.dataset.former || "[]") ?? [];
    } catch { /* the line of former names is lost, not the rename */ }
    nameCell.replaceChildren();
    render(h(NameRow, {
        name: nameCell.dataset.name ?? "",
        former,
        csrf: nameCell.dataset.csrf ?? "",
        // The letter stands in for the avatar only where the server's block stays: no avatar under a lock.
        onRenamed: initial => {
            document.querySelectorAll("#avatar .avatar-letter").forEach(el => { el.textContent = initial; });
        },
    }), nameCell);
}

const block = document.getElementById("avatar");
const row = block?.querySelector<HTMLElement>(".avatar-row");
if (block && row && !block.hasAttribute("data-locked")) {
    row.replaceChildren();
    render(h(AvatarRow, { saved: block.dataset.avatar || null, csrf: block.dataset.csrf ?? "" }), row);
}
