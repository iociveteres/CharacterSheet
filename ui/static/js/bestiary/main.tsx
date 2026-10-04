// Entry point of the /bestiary page bundle (ui/html/pages/bestiary.html).
// The page has a socket of its own: the user edits their creatures and rolls
// from any sheet on it.
import { render } from "preact";
import type { BestiaryPayload } from "./payload.gen";
import { initBestiary } from "./actions";
import { listenRemote } from "./remote";
import { listenRolls } from "./rolls";
import { Bestiary, Toasts } from "./components/Bestiary";
import "./socket";
// network.ts applies the server's changes to the sheets on the page; reload.ts
// reads them again after a drop or a refused edit.
import "../sheet/network";
import "../sheet/reload";

const payload = JSON.parse(document.getElementById("bestiary-state")!.textContent!) as BestiaryPayload;
listenRemote();
listenRolls();
render(<Bestiary />, document.getElementById("bestiary")!);
render(<Toasts />, document.getElementById("toasts")!);
// A link to a collection lands here with ?collection=, and so does a reload;
// the room's "Edit in bestiary" adds &creature=.
const params = new URLSearchParams(location.search);
void initBestiary(payload, Number(params.get("collection")) || null, Number(params.get("creature")) || null);
