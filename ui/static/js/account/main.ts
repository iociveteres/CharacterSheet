// Entry point of the Account page bundle (ui/html/pages/account.html): the
// avatar block's crop window. Without this script the page shows the avatar
// and Delete as the server draws them; under a moderator's lock there is
// nothing to upload, so the server's block stays.
import { h, render } from "preact";
import { AvatarRow } from "./Avatar";

const block = document.getElementById("avatar");
const row = block?.querySelector<HTMLElement>(".avatar-row");
if (block && row && !block.hasAttribute("data-locked")) {
    row.replaceChildren();
    render(h(AvatarRow, { saved: block.dataset.avatar || null, csrf: block.dataset.csrf ?? "" }), row);
}
